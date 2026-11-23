import { Inject, Injectable } from '@nestjs/common';
import { spotCheckSampled } from '@md-wiki/domain';
import { Prisma, type SpotCheck } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { logger } from '../common/request-id.middleware.js';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AfterPublish } from '../review/ports.js';
import { userRef } from '../review/views.js';
import type { Wire } from '../wiki/read.dto.js';
import { settingsOf } from './agent-facts.js';
import type { SpotCheckDto, SpotCheckInput } from './agent.dto.js';
import { pageAuthorsOf } from './page-authors.js';
import {
  AUTHOR_NOTIFIER,
  CONFIRMED_ERRORS,
  type AuthorNotifier,
  type ConfirmedErrors,
} from './ports.js';

const userSelect = { id: true, name: true, kind: true } as const;
const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * After a publication is done (system-logic §7.8.7, D-213, D-214): one PublishFollowUp per
 * publication — a digest item to the page authors for every agent-approved publication, and a
 * deterministic spot-check sample of agent approvals. A failed spot check is a confirmed error.
 */
@Injectable()
export class SpotChecksService implements AfterPublish {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AUTHOR_NOTIFIER) private readonly notifier: AuthorNotifier,
    @Inject(CONFIRMED_ERRORS) private readonly errors: ConfirmedErrors,
  ) {}

  /** Idempotent: the PublishFollowUp primary key is the publication id. */
  async published(proposalId: string): Promise<void> {
    const pub = await this.db.publication.findFirst({
      where: { proposalId, phase: 'done' },
      orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
      include: { proposal: true, decision: true },
    });
    if (!pub?.versionLabel) return;
    if (await this.db.publishFollowUp.findUnique({ where: { publicationId: pub.id } })) return;
    const reviewer = await this.db.user.findUnique({
      where: { id: pub.decision.reviewerId },
      select: { id: true, kind: true },
    });
    const agentApproved = reviewer?.kind === 'agent';
    const authors = await pageAuthorsOf(this.db, pub.targetPath, pub.proposal.submitterId);
    const recipients = authors.ids.filter((id) => id !== pub.decision.reviewerId);
    const settings = await settingsOf(this.db);
    const sampled =
      agentApproved && spotCheckSampled(pub.decisionId, settings.spotCheckRate) && recipients.length > 0;
    let spot: SpotCheck | null = null;
    try {
      spot = await this.db.$transaction(async (tx) => {
        const row = sampled
          ? await tx.spotCheck.create({
              data: {
                proposalId,
                decisionId: pub.decisionId,
                publicationId: pub.id,
                path: pub.targetPath,
                versionLabel: pub.versionLabel ?? '',
                reviewerId: pub.decision.reviewerId,
                assigneeIds: recipients,
              },
            })
          : null;
        await tx.publishFollowUp.create({
          data: {
            publicationId: pub.id,
            proposalId,
            sampled: row !== null,
            spotCheckId: row?.id ?? null,
            notified: agentApproved ? recipients : [],
          },
        });
        if (row)
          await audit(tx, null, 'spot_check.sampled', 'proposal', proposalId, {
            spotCheckId: row.id,
            decisionId: pub.decisionId,
            rate: settings.spotCheckRate,
            assigneeIds: recipients,
          });
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return; // a concurrent follow-up won
      throw error;
    }
    const proposal = {
      id: pub.proposal.id,
      slug: pub.proposal.slug,
      title: pub.proposal.title,
      targetPath: pub.targetPath,
    };
    try {
      if (agentApproved && recipients.length)
        await this.notifier.published({
          proposal,
          versionLabel: pub.versionLabel,
          reviewerKind: 'agent',
          auto: pub.auto,
          publishedAt: pub.finishedAt ?? new Date(),
          recipients,
        });
      if (spot) {
        await this.notifier.spotCheckRequested({ spotCheckId: spot.id, proposal, recipients });
        this.events.inbox(recipients);
      }
    } catch (error) {
      logger.warn({ err: error, proposalId }, 'after-publish notification failed');
    }
  }

  private async load(id: string) {
    const spot = await this.db.spotCheck.findUnique({ where: { id } });
    if (!spot) throw new AppError('NOT_FOUND');
    return spot;
  }

  private mayDecide(spot: SpotCheck, identity: Identity) {
    return (
      spot.outcome === null &&
      identity.user.id !== spot.reviewerId &&
      (spot.assigneeIds.includes(identity.user.id) || identity.user.roles.includes('owner'))
    );
  }

  /** Visible to its assignees and to roles ≥ reviewer. */
  async get(identity: Identity, id: string): Promise<Wire<SpotCheckDto>> {
    const spot = await this.load(id);
    const reviewerRole = identity.user.roles.some((r) => r !== 'reader' && r !== 'contributor');
    if (!reviewerRole && !spot.assigneeIds.includes(identity.user.id))
      throw new AppError('NOT_FOUND');
    return this.dto(spot, identity);
  }

  /** Decided once (DB trigger); failed → confirmed error in the same transaction (D-214). */
  async decide(identity: Identity, id: string, input: SpotCheckInput): Promise<Wire<SpotCheckDto>> {
    const seen = await this.get(identity, id);
    if (identity.user.kind === 'agent') throw new AppError('FORBIDDEN');
    if (seen.reviewer.id === identity.user.id) throw new AppError('SELF_REVIEW');
    const spot = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SpotCheck" WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.spotCheck.findUniqueOrThrow({ where: { id } });
      if (row.outcome !== null)
        throw new AppError('PRECONDITION_FAILED', 'This spot check was already decided');
      if (!row.assigneeIds.includes(identity.user.id) && !identity.user.roles.includes('owner'))
        throw new AppError('NOT_ASSIGNED');
      const proposal = await tx.proposal.findUniqueOrThrow({ where: { id: row.proposalId } });
      const sections = await tx.publishedSection.findMany({
        where: { publicationId: row.publicationId },
        select: { anchor: true, sectionHash: true },
        orderBy: { anchor: 'asc' },
      });
      const wanted =
        input.outcome === 'failed'
          ? input.anchors?.length
            ? input.anchors
            : proposal.section
              ? [proposal.section]
              : sections.map((s) => s.anchor)
          : [];
      const unknown = wanted.filter((a) => !sections.some((s) => s.anchor === a));
      if (unknown.length)
        throw new AppError(
          'VALIDATION_FAILED',
          undefined,
          unknown.map((a) => ({ path: 'anchors', code: 'UNKNOWN_ANCHOR', message: a })),
        );
      const now = new Date();
      const updated = await tx.spotCheck.update({
        where: { id },
        data: {
          outcome: input.outcome,
          reason: input.reason,
          anchors: wanted,
          decidedById: identity.user.id,
          decidedAt: now,
        },
      });
      if (input.outcome === 'failed')
        await this.errors.record(tx, {
          source: 'spot_check',
          spotCheckId: id,
          proposalId: row.proposalId,
          path: row.path,
          versionLabel: row.versionLabel,
          sections: sections.filter((s) => wanted.includes(s.anchor)),
          actorId: identity.user.id,
          reason: input.reason,
          at: now,
        });
      await audit(tx, identity.user, 'spot_check.decided', 'proposal', row.proposalId, {
        spotCheckId: id,
        outcome: input.outcome,
        anchors: wanted,
      });
      return updated;
    });
    this.events.inbox(spot.assigneeIds);
    this.events.page(spot.path);
    return this.dto(spot, identity);
  }

  async dto(spot: SpotCheck, identity: Identity): Promise<Wire<SpotCheckDto>> {
    const [proposal, page, people] = await Promise.all([
      this.db.proposal.findUniqueOrThrow({
        where: { id: spot.proposalId },
        select: { slug: true, title: true, targetPath: true },
      }),
      this.db.page.findUnique({ where: { path: spot.path }, select: { title: true } }),
      this.db.user.findMany({
        where: {
          id: {
            in: [spot.reviewerId, ...spot.assigneeIds, spot.decidedById].filter(
              (x): x is string => x !== null,
            ),
          },
        },
        select: userSelect,
      }),
    ]);
    const byId = new Map(people.map((u) => [u.id, userRef(u)]));
    const ref = (id: string) => byId.get(id) ?? { id, name: 'Unknown', kind: 'human' as const };
    return {
      id: spot.id,
      slug: proposal.slug,
      title: proposal.title,
      targetPath: proposal.targetPath,
      pageTitle: page?.title ?? proposal.targetPath,
      versionLabel: spot.versionLabel,
      decisionId: spot.decisionId,
      reviewer: ref(spot.reviewerId),
      assignees: spot.assigneeIds.map(ref),
      sampledAt: spot.sampledAt.toISOString(),
      outcome: spot.outcome,
      reason: spot.reason,
      anchors: spot.anchors,
      decidedBy: spot.decidedById ? ref(spot.decidedById) : null,
      decidedAt: spot.decidedAt?.toISOString() ?? null,
      canDecide: this.mayDecide(spot, identity),
    };
  }
}
