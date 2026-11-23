import {
  DEFAULT_TRIGGER_CONFIG,
  type CustomTrigger,
  type ReviewModel,
  type TriggerConfig,
} from '@md-wiki/domain';
import type { Prisma, ReviewSettings } from '@prisma/client';

type Db = Prisma.TransactionClient;

/** The settings row (id 1); the migration inserts it, tests on old schemas get the defaults. */
export async function settingsOf(db: Db): Promise<ReviewSettings> {
  return (
    (await db.reviewSettings.findUnique({ where: { id: 1 } })) ??
    (await db.reviewSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }))
  );
}

export function triggerConfigOf(s: Pick<ReviewSettings, 'agentEditsHumanPages' | 'customTriggers'>) {
  const custom = Array.isArray(s.customTriggers)
    ? (s.customTriggers as unknown as CustomTrigger[])
    : [];
  return {
    ...DEFAULT_TRIGGER_CONFIG,
    agentEditsHumanPages: s.agentEditsHumanPages,
    custom,
  } satisfies TriggerConfig;
}

/**
 * The reviewer agent as the assignment rule sees it (D-200, D-201): the seeded agent user,
 * enabled, with a live (unrevoked, unexpired) token that has scope `review`.
 */
export async function agentFacts(
  db: Db,
  settings?: ReviewSettings,
): Promise<{ model: ReviewModel; paused: boolean; agent: { id: string; available: boolean } | null }> {
  const s = settings ?? (await settingsOf(db));
  if (!s.reviewerAgentId) return { model: s.reviewModel, paused: s.agentPaused, agent: null };
  const user = await db.user.findUnique({
    where: { id: s.reviewerAgentId },
    select: { id: true, kind: true, disabledAt: true },
  });
  if (!user || user.kind !== 'agent' || user.disabledAt)
    return { model: s.reviewModel, paused: s.agentPaused, agent: user ? { id: user.id, available: false } : null };
  const now = new Date();
  const tokens = await db.apiToken.count({
    where: {
      userId: user.id,
      revokedAt: null,
      scopes: { has: 'review' },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  return { model: s.reviewModel, paused: s.agentPaused, agent: { id: user.id, available: tokens > 0 } };
}

/**
 * Who besides the submitter and roles ≥ reviewer may see a proposal (D-208): anyone who holds
 * or held an assignment on it, a page author of one of its escalations, or a spot-check assignee.
 */
export async function inProposalAudience(db: Db, proposalId: string, userId: string) {
  const [assigned, escalated, spot] = await Promise.all([
    db.assignment.count({ where: { proposalId, assigneeId: userId } }),
    db.escalation.count({ where: { proposalId, assigneeIds: { has: userId } } }),
    db.spotCheck.count({ where: { proposalId, assigneeIds: { has: userId } } }),
  ]);
  return assigned + escalated + spot > 0;
}

/** The caller holds an open escalation assignment on the proposal (D-208). */
export async function holdsEscalation(db: Db, proposalId: string, userId: string) {
  return (
    (await db.assignment.count({
      where: { proposalId, assigneeId: userId, closedAt: null, reason: 'escalation' },
    })) > 0
  );
}
