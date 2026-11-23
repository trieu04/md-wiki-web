import { Inject, Injectable } from '@nestjs/common';
import { can, composeReplacement, conflictView, type Manifest } from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { ContributionsService } from '../contributions/contributions.service.js';
import { ProposalFreezer } from '../contributions/freezer.service.js';
import { invalid, type Pin } from '../contributions/pins.js';
import { parseManifest } from '../contributions/views.js';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WikiIndexer } from '../wiki/indexer/wiki-indexer.js';
import { decodeMarkdown, wikiPath, type WikiStorage } from '../wiki/storage/wiki-storage.js';
import { WIKI_STORAGE } from '../wiki/wiki.module.js';
import { closeAssignments } from './assignments.js';
import type { ConflictInput } from './review.dto.js';
import { ReviewService } from './review.service.js';
import { actorOf, conflictResolutionDto, detailInclude, mayRead } from './views.js';

/** v1 / v2 / proposal conflicts and their three outcomes (system-logic §7.4.7, D-84). */
@Injectable()
export class ConflictsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WIKI_STORAGE) private readonly storage: WikiStorage,
    @Inject(WikiIndexer) private readonly indexer: WikiIndexer,
    @Inject(ProposalFreezer) private readonly freezer: ProposalFreezer,
    @Inject(ContributionsService) private readonly contributions: ContributionsService,
    @Inject(ReviewService) private readonly review: ReviewService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async resolve(identity: Identity, slug: string, input: ConflictInput) {
    const row = await this.review.visible(identity, slug);
    const isSubmitter = row.submitterId === identity.user.id;
    if (!((isSubmitter && can(actorOf(identity), 'proposal.submit', {}).ok) || mayRead(identity)))
      throw new AppError('FORBIDDEN');
    if (input.outcome === 'keep_current' && input.replacement !== undefined)
      throw invalid('replacement', 'replacement', 'keep_current takes no replacement');
    if (input.outcome === 'merge' && input.replacement === undefined)
      throw invalid('replacement', 'replacement', 'merge needs the combined text');

    const replacementId = await this.storage.withRootLock(async () => {
      if (row.conflict) throw new AppError('ALREADY_EXISTS', 'The conflict is already resolved');
      if (row.state !== 'pending' && row.state !== 'stale')
        throw new AppError('PRECONDITION_FAILED', 'Only pending or stale proposals have conflicts');
      const current = await this.indexer.observe(wikiPath(row.targetPath));
      if ((current?.sha256 ?? null) === row.baseSha256)
        throw new AppError('PRECONDITION_FAILED', 'The page has not changed since the proposal');
      const record = (tx: Prisma.TransactionClient, replacement: string | null) =>
        this.record(
          tx,
          row.id,
          identity,
          input,
          row.baseSha256,
          current?.sha256 ?? null,
          replacement,
        );
      if (input.outcome === 'keep_current') {
        await this.db.$transaction((tx) => record(tx, null));
        return null;
      }
      const currentText = current ? decodeMarkdown(current.content) : null;
      const base = row.base ? decodeMarkdown(Buffer.from(row.base)) : null;
      const view = conflictView(
        base,
        currentText,
        decodeMarkdown(Buffer.from(row.proposed)),
        row.section,
      );
      const composed = composeReplacement(
        currentText,
        view,
        row.section,
        input.replacement ?? view.proposedText,
      );
      if (!composed.ok)
        throw invalid('replacement', 'UNKNOWN_SECTION', 'section not in the current page');
      const m: Manifest = parseManifest(row);
      const pins = (role: 'source' | 'scope') =>
        row.refs
          .filter((r) => r.role === role)
          .map((r) => ({
            path: r.snapshot.path,
            snapshotId: r.snapshotId,
            versionLabel: r.snapshot.label,
            sha256: r.snapshot.sha256,
            impact: r.impact ?? '',
          }));
      const basePin: Pin | null = current
        ? {
            path: row.targetPath,
            snapshotId: current.snapshotId,
            versionLabel: current.versionLabel,
            sha256: current.sha256,
          }
        : null;
      const frozen = await this.freezer.freeze({
        submitter: row.submitter,
        origin: row.origin,
        targetPath: row.targetPath,
        base: basePin,
        proposed: Buffer.from(composed.value, 'utf8'),
        title: row.title,
        reason: input.reason,
        section: view.scope === 'section' && current ? row.section : null,
        sources: pins('source').map(({ impact: _i, ...pin }) => pin),
        related: pins('scope'),
        appliesTo: m.applies_to,
        ...(m.author_metadata && { authorMetadata: m.author_metadata }),
        commit: (tx, newId) => record(tx, newId),
      });
      return frozen.proposalId;
    });
    this.events.proposal(
      row.slug,
      row.submitterId,
      row.state === 'pending' ? 'rejected' : row.state,
    );
    const resolved = await this.db.conflictResolution.findUniqueOrThrow({
      where: { proposalId: row.id },
      include: detailInclude.conflict.include,
    });
    return {
      resolution: conflictResolutionDto(resolved),
      replacement: replacementId ? await this.contributions.proposalDto(replacementId) : null,
    };
  }

  /** The ConflictResolution and the old proposal's transition, in the caller's transaction. */
  private async record(
    tx: Prisma.TransactionClient,
    proposalId: string,
    identity: Identity,
    input: ConflictInput,
    baseSha256: string | null,
    currentSha256: string | null,
    replacementId: string | null,
  ) {
    await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${proposalId}::uuid FOR UPDATE`;
    const p = await tx.proposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { conflict: { select: { id: true } } },
    });
    if (p.conflict) throw new AppError('ALREADY_EXISTS', 'The conflict is already resolved');
    if (p.state !== 'pending' && p.state !== 'stale')
      throw new AppError('PRECONDITION_FAILED', 'Only pending or stale proposals have conflicts');
    const now = new Date();
    await tx.conflictResolution.create({
      data: {
        proposalId,
        actorId: identity.user.id,
        outcome: input.outcome,
        baseSha256,
        currentSha256,
        replacementId,
        reason: input.reason,
        createdAt: now,
      },
    });
    if (p.state === 'pending') {
      await tx.proposal.update({
        where: { id: proposalId },
        data: { state: 'rejected', updatedAt: now },
      });
      await closeAssignments(tx, proposalId, now);
    }
    const replacement = replacementId
      ? await tx.proposal.findUnique({ where: { id: replacementId }, select: { slug: true } })
      : null;
    await audit(tx, identity.user, 'proposal.conflict_resolved', 'proposal', proposalId, {
      outcome: input.outcome,
      replacementSlug: replacement?.slug ?? null,
      baseSha256,
      currentSha256,
    });
  }
}
