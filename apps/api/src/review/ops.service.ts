import { Inject, Injectable } from '@nestjs/common';
import { diskMatch, pageTitle, resolutionAllowed } from '@md-wiki/domain';
import { Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { decodeCursor, encodeCursor } from '../contributions/pins.js';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Wire } from '../wiki/read.dto.js';
import type { WikiStorage } from '../wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../wiki/wiki.module.js';
import { PublishService } from './publish.service.js';
import type { AuditInput, AuditPageDto, BlockedListDto, ResolutionInput } from './review.dto.js';
import { userRef } from './views.js';

/** Operations › Blocked targets and Audit (system-logic §7.4.6, §7.4.8). Owner only. */
@Injectable()
export class OpsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WIKI_STORAGE) private readonly storage: WikiStorage,
    @Inject(PublishService) private readonly publisher: PublishService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async blocked(): Promise<Wire<BlockedListDto>> {
    const rows = await this.db.publication.findMany({
      where: { phase: 'unknown' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { proposal: { select: { slug: true, title: true } } },
    });
    const pages = await this.db.page.findMany({
      where: { path: { in: rows.map((r) => r.targetPath) } },
      select: { path: true, title: true },
    });
    const titles = new Map(pages.map((p) => [p.path, p.title]));
    const items = [];
    for (const r of rows) {
      let disk: { sha256: string | null; matches: 'new' | 'old' | 'neither' | 'missing' } | null;
      try {
        const sha = await this.publisher.readSha(r.targetPath);
        disk = { sha256: sha, matches: diskMatch(sha, r.artifactHash, r.baseSha256) };
      } catch {
        disk = null;
      }
      const waiting = await this.db.proposal.findMany({
        where: { targetPath: r.targetPath, state: 'approved', id: { not: r.proposalId } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { slug: true },
      });
      items.push({
        slug: r.proposal.slug,
        title: r.proposal.title,
        targetPath: r.targetPath,
        pageTitle: titles.get(r.targetPath) ?? pageTitle(r.targetPath, []),
        since: r.updatedAt.toISOString(),
        error: r.error,
        publicationId: r.id,
        expected: { sha256: r.artifactHash },
        old: { sha256: r.baseSha256 },
        disk,
        waiting: waiting.map((w) => w.slug),
      });
    }
    return { items };
  }

  /** An owner's written / not-written conclusion for an unknown publication (D-80). */
  async resolve(identity: Identity, slug: string, input: ResolutionInput) {
    const proposal = await this.db.proposal.findUnique({
      where: { slug },
      select: { id: true, slug: true, submitterId: true, targetPath: true },
    });
    if (!proposal) throw new AppError('NOT_FOUND');
    const resolved = await this.storage.withRootLock(async () => {
      const pub = await this.db.publication.findFirst({
        where: { proposalId: proposal.id, phase: 'unknown' },
      });
      if (!pub) throw new AppError('PRECONDITION_FAILED', 'No unknown publication to resolve');
      const disk = await this.publisher.readSha(pub.targetPath);
      if (!resolutionAllowed(input.outcome, disk, pub.artifactHash))
        throw new AppError(
          'PRECONDITION_FAILED',
          input.outcome === 'written'
            ? 'The file on disk is not the approved artifact'
            : 'The file on disk is the approved artifact',
        );
      const retry = await this.db.$transaction(async (tx) => {
        const now = new Date();
        const moved = await tx.publication.updateMany({
          where: { id: pub.id, phase: 'unknown' },
          data:
            input.outcome === 'written'
              ? { phase: 'written', writtenAt: now, updatedAt: now }
              : { phase: 'not_written', finishedAt: now, updatedAt: now },
        });
        if (moved.count !== 1) throw new AppError('PRECONDITION_FAILED', 'Already resolved');
        await tx.resolution.create({
          data: {
            publicationId: pub.id,
            proposalId: proposal.id,
            actorId: identity.user.id,
            outcome: input.outcome,
            evidence: input.evidence,
            diskSha256: disk,
            createdAt: now,
          },
        });
        await audit(tx, identity.user, 'publication.resolved', 'proposal', proposal.id, {
          publicationId: pub.id,
          outcome: input.outcome,
          evidence: input.evidence,
          diskSha256: disk,
        });
        return input.outcome === 'not_written' && this.publisher.autoPublish
          ? this.publisher.enqueue(tx, proposal.id, pub.decisionId, 'retry')
          : null;
      });
      this.events.publication(
        proposal.slug,
        proposal.submitterId,
        input.outcome === 'written' ? 'written' : 'not_written',
      );
      if (input.outcome === 'written') await this.publisher.finish(pub.id);
      return retry;
    });
    if (resolved) await this.publisher.processOutbox(resolved.id);
    // Approved proposals that waited behind this target try again.
    await this.publisher.processPending(proposal.targetPath);
  }

  async audit(input: AuditInput): Promise<Wire<AuditPageDto>> {
    const limit = input.limit ?? 25;
    const cursor = decodeCursor(input.cursor);
    const rows = await this.db.auditEvent.findMany({
      where: {
        ...(input.action !== undefined && { action: input.action }),
        ...(input.subjectType !== undefined && { subjectType: input.subjectType }),
        ...(input.subjectId !== undefined && { subjectId: input.subjectId }),
        ...(input.actorId !== undefined && { actorId: input.actorId }),
        ...(cursor && {
          OR: [{ at: { lt: cursor.at } }, { at: cursor.at, id: { lt: cursor.id } }],
        }),
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { actor: { select: { id: true, name: true, kind: true } } },
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((e) => ({
        id: e.id,
        at: e.at.toISOString(),
        action: e.action,
        actorKind: e.actorKind,
        actor: e.actor ? userRef(e.actor) : null,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        data: e.data as Prisma.JsonObject,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.at, last.id) : null,
    };
  }
}
