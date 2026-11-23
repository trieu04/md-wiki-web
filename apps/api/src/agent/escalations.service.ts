import { Inject, Injectable } from '@nestjs/common';
import {
  can,
  JUDGEMENT_TRIGGER,
  knownTriggerIds,
  reminderDue,
  TRIGGER_TEXT,
  type DefaultTrigger,
} from '@md-wiki/domain';
import type { Escalation, Prisma, Proposal } from '@prisma/client';
import type { Identity } from '../auth/auth.service.js';
import { audit } from '../auth/credentials.js';
import { AppError } from '../common/app-error.js';
import { logger } from '../common/request-id.middleware.js';
import { DiscussionsService, type TopicRow } from '../discussions/discussions.service.js';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { actorOf, mayRead, userRef } from '../review/views.js';
import type { Wire } from '../wiki/read.dto.js';
import {
  holdsEscalation,
  inProposalAudience,
  settingsOf,
  triggerConfigOf,
} from './agent-facts.js';
import type {
  AgentReviewDto,
  EscalationDto,
  EscalationInput,
  EscalationStateDto,
} from './agent.dto.js';
import { pageAuthorsOf } from './page-authors.js';
import { AUTHOR_NOTIFIER, type AuthorNotifier, type EscalationNotice } from './ports.js';
import { SpotChecksService } from './spot-checks.service.js';
import { MandatoryTriggers } from './triggers.js';

const userSelect = { id: true, name: true, kind: true } as const;

export function triggerTitle(id: string): string {
  return (TRIGGER_TEXT as Record<string, { title: string } | undefined>)[id]?.title ?? id;
}

/**
 * Escalations (system-logic §7.8.5, D-207): the agent (or a reviewer) hands a proposal to its
 * page authors — a re-review they decide, or a discussion that holds approval until it is
 * resolved. Silence never decides: reminders repeat, nothing times out.
 */
@Injectable()
export class EscalationsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(DiscussionsService) private readonly discussions: DiscussionsService,
    @Inject(MandatoryTriggers) private readonly triggers: MandatoryTriggers,
    @Inject(SpotChecksService) private readonly spotChecks: SpotChecksService,
    @Inject(AUTHOR_NOTIFIER) private readonly notifier: AuthorNotifier,
  ) {}

  private async visible(identity: Identity, slug: string): Promise<Proposal> {
    const p = await this.db.proposal.findUnique({ where: { slug } });
    if (
      !p ||
      (p.submitterId !== identity.user.id &&
        !mayRead(identity) &&
        !(await inProposalAudience(this.db, p.id, identity.user.id)))
    )
      throw new AppError('NOT_FOUND');
    return p;
  }

  /** Role ≥ reviewer with scope `review`, or a page author holding an escalation (D-208). */
  private async mayEscalate(identity: Identity, proposalId: string | null) {
    const base = { hasOpenAssignment: true, isOwnProposal: false };
    if (can(actorOf(identity), 'proposal.decide', base).ok) return true;
    return (
      proposalId !== null &&
      can(actorOf(identity), 'proposal.decide', {
        ...base,
        isEscalationAssignee: await holdsEscalation(this.db, proposalId, identity.user.id),
      }).ok
    );
  }

  async escalate(identity: Identity, slug: string, input: EscalationInput) {
    const found = await this.db.proposal.findUnique({ where: { slug }, select: { id: true } });
    if (!(await this.mayEscalate(identity, found?.id ?? null))) throw new AppError('FORBIDDEN');
    const seen = await this.visible(identity, slug);
    const user = identity.user;
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${seen.id}::uuid FOR UPDATE`;
      const p = await tx.proposal.findUniqueOrThrow({ where: { id: seen.id } });
      const gated = await this.triggers.gate(tx, user);
      if (gated) throw new AppError('PRECONDITION_FAILED', gated);
      if (p.state !== 'pending')
        throw new AppError('PRECONDITION_FAILED', 'Only a pending proposal can be escalated');
      if (input.bundleHash !== p.bundleHash)
        throw new AppError('PRECONDITION_FAILED', 'The bundle hash is not the one you read');
      if (p.submitterId === user.id) throw new AppError('SELF_REVIEW');
      const holds =
        (await tx.assignment.count({
          where: { proposalId: p.id, assigneeId: user.id, closedAt: null },
        })) > 0;
      if (!holds && !user.roles.includes('owner')) throw new AppError('NOT_ASSIGNED');
      if (
        await tx.escalation.findFirst({
          where: { proposalId: p.id, kind: input.kind, resolvedAt: null },
        })
      )
        throw new AppError('ALREADY_EXISTS', `An open ${input.kind} escalation exists`);
      const settings = await settingsOf(tx);
      const known = knownTriggerIds(triggerConfigOf(settings));
      const unknown = (input.triggers ?? []).filter((t) => !known.has(t));
      if (unknown.length)
        throw new AppError(
          'VALIDATION_FAILED',
          undefined,
          unknown.map((t) => ({ path: 'triggers', code: 'UNKNOWN_TRIGGER', message: t })),
        );
      const firing = (await this.triggers.evaluate(tx, p)).map((t) => t.id);
      const cited = [...new Set([...(input.triggers ?? []), ...firing])];
      const triggers = cited.length ? cited : [JUDGEMENT_TRIGGER];
      const authors = await pageAuthorsOf(tx, p.targetPath, p.submitterId);
      const assigneeIds = authors.ids.filter((id) => id !== user.id);
      if (!assigneeIds.length)
        throw new AppError('PRECONDITION_FAILED', 'Nobody to escalate to: no page author or owner');
      const now = new Date();
      let topic: TopicRow | null = null;
      if (input.kind === 'rereview') {
        // The agent (and the caller) hand over; the page authors decide (any one of them).
        const agents = await tx.user.findMany({ where: { kind: 'agent' }, select: { id: true } });
        await tx.assignment.updateMany({
          where: {
            proposalId: p.id,
            closedAt: null,
            assigneeId: { in: [user.id, ...agents.map((a) => a.id)] },
          },
          data: { closedAt: now },
        });
        for (const assigneeId of assigneeIds) {
          if (
            await tx.assignment.findFirst({
              where: { proposalId: p.id, assigneeId, closedAt: null },
            })
          )
            continue;
          await tx.assignment.create({
            data: {
              proposalId: p.id,
              assigneeId,
              reason: 'escalation',
              trigger: triggers.join(',').slice(0, 500),
              createdById: user.id,
              createdAt: now,
            },
          });
          await audit(tx, user, 'proposal.assigned', 'proposal', p.id, {
            assigneeId,
            reason: 'escalation',
          });
        }
      } else {
        topic = await this.discussions.escalationThread(tx, p, user, input.reason, assigneeIds);
      }
      const escalation = await tx.escalation.create({
        data: {
          proposalId: p.id,
          kind: input.kind,
          triggers,
          notes: input.reason,
          requestedById: user.id,
          bundleHash: p.bundleHash,
          assigneeIds,
          topicId: topic?.id ?? null,
          createdAt: now,
        },
      });
      await audit(tx, user, 'proposal.escalated', 'proposal', p.id, {
        escalationId: escalation.id,
        kind: input.kind,
        triggers,
        assigneeIds,
        topicId: topic?.id ?? null,
        source: authors.source,
      });
      return { p, escalation, topic };
    });
    if (result.topic) this.discussions.announceTopic(result.topic);
    this.events.proposal(result.p.slug, result.p.submitterId, result.p.state);
    this.events.inbox(result.escalation.assigneeIds);
    await this.notify('escalated', result.escalation, result.p);
    return this.state(identity, slug);
  }

  private async notify(
    kind: 'escalated' | 'reminded',
    e: Escalation,
    p: Pick<Proposal, 'id' | 'slug' | 'title' | 'targetPath'>,
  ) {
    const notice: EscalationNotice = {
      escalationId: e.id,
      kind: e.kind,
      proposal: { id: p.id, slug: p.slug, title: p.title, targetPath: p.targetPath },
      triggers: e.triggers,
      notes: e.notes,
      recipients: e.assigneeIds,
      reminder: e.reminders,
    };
    try {
      await this.notifier[kind](notice);
    } catch (error) {
      logger.warn({ err: error, escalationId: e.id }, 'author notification failed');
    }
  }

  /** Reminders (D-212): every `reminderDays` per open escalation; returns how many were sent. */
  async remind(now = new Date()): Promise<number> {
    const settings = await settingsOf(this.db);
    const open = await this.db.escalation.findMany({
      where: { resolvedAt: null, proposal: { state: 'pending' } },
      include: { proposal: { select: { id: true, slug: true, title: true, targetPath: true } } },
    });
    let sent = 0;
    for (const e of open) {
      if (
        !reminderDue(
          {
            createdAt: e.createdAt.getTime(),
            lastRemindedAt: e.lastRemindedAt?.getTime() ?? null,
            resolved: false,
          },
          settings.reminderDays,
          now.getTime(),
        )
      )
        continue;
      const updated = await this.db.$transaction(async (tx) => {
        const { count } = await tx.escalation.updateMany({
          where: { id: e.id, resolvedAt: null, reminders: e.reminders },
          data: { reminders: e.reminders + 1, lastRemindedAt: now },
        });
        if (count)
          await audit(tx, null, 'escalation.reminded', 'proposal', e.proposalId, {
            escalationId: e.id,
            reminder: e.reminders + 1,
          });
        return count > 0;
      });
      if (!updated) continue;
      sent++;
      this.events.inbox(e.assigneeIds);
      await this.notify('reminded', { ...e, reminders: e.reminders + 1, lastRemindedAt: now }, e.proposal);
    }
    return sent;
  }

  // ---- read model ---------------------------------------------------------------------------

  async state(identity: Identity, slug: string): Promise<Wire<EscalationStateDto>> {
    const p = await this.visible(identity, slug);
    const [firing, authors, escalations, reviews, runs, spot] = await Promise.all([
      p.state === 'pending' ? this.triggers.evaluate(this.db, p) : Promise.resolve([]),
      pageAuthorsOf(this.db, p.targetPath, p.submitterId),
      this.db.escalation.findMany({
        where: { proposalId: p.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.agentReview.findMany({
        where: { proposalId: p.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      this.db.aiJob.findMany({
        where: { proposalId: p.id, kind: 'agent_review' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      this.db.spotCheck.findUnique({ where: { proposalId: p.id } }),
    ]);
    const ids = new Set<string>([
      ...authors.ids,
      ...escalations.flatMap((e) => [e.requestedById, ...e.assigneeIds]),
    ]);
    const people = await this.db.user.findMany({
      where: { id: { in: [...ids] } },
      select: userSelect,
    });
    const byId = new Map(people.map((u) => [u.id, userRef(u)]));
    const ref = (id: string) => byId.get(id) ?? { id, name: 'Unknown', kind: 'human' as const };
    const holds =
      (await this.db.assignment.count({
        where: { proposalId: p.id, assigneeId: identity.user.id, closedAt: null },
      })) > 0;
    return {
      slug: p.slug,
      bundleHash: p.bundleHash,
      state: p.state,
      firing: firing.map((t) => ({ id: t.id, title: triggerTitle(t.id), detail: t.detail })),
      evaluatedAt: new Date().toISOString(),
      pageAuthors: { users: authors.ids.map(ref), source: authors.source },
      escalations: escalations.map((e) => escalationDto(e, ref)),
      agentReviews: reviews.map(agentReviewDto),
      agentRuns: runs.map((r) => ({
        jobId: r.id,
        status: r.status,
        trigger: r.trigger as 'after_check' | 'returned' | 'resumed',
        errorCode: (r.error as { code?: string } | null)?.code ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      spotCheck: spot ? await this.spotChecks.dto(spot, identity) : null,
      can: {
        escalate:
          p.state === 'pending' &&
          p.submitterId !== identity.user.id &&
          (holds || identity.user.roles.includes('owner')) &&
          (await this.mayEscalate(identity, p.id)),
      },
    };
  }
}

export function escalationDto(
  e: Escalation,
  ref: (id: string) => Wire<EscalationDto>['requestedBy'],
): Wire<EscalationDto> {
  return {
    id: e.id,
    kind: e.kind,
    triggers: e.triggers,
    notes: e.notes,
    requestedBy: ref(e.requestedById),
    assignees: e.assigneeIds.map(ref),
    topicId: e.topicId,
    createdAt: e.createdAt.toISOString(),
    resolvedAt: e.resolvedAt?.toISOString() ?? null,
    resolution: e.resolution,
    reminders: e.reminders,
    lastRemindedAt: e.lastRemindedAt?.toISOString() ?? null,
  };
}

export function agentReviewDto(r: Prisma.AgentReviewGetPayload<object>): Wire<AgentReviewDto> {
  return {
    id: r.id,
    jobId: r.jobId,
    outcome: r.outcome,
    verdict: r.verdict as Wire<AgentReviewDto>['verdict'],
    notes: r.notes,
    claims: r.claims as unknown as Wire<AgentReviewDto>['claims'],
    refusals: r.refusals as unknown as Wire<AgentReviewDto>['refusals'],
    decisionId: r.decisionId,
    escalationId: r.escalationId,
    provider: r.provider,
    model: r.model,
    promptVersion: r.promptVersion,
    createdAt: r.createdAt.toISOString(),
  };
}

export type { DefaultTrigger };
