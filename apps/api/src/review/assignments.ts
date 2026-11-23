import { pickReviewer } from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import { agentFacts } from '../agent/agent-facts.js';
import { audit } from '../auth/credentials.js';

/**
 * Who reviews a proposal (system-logic §7.8.2, D-201): the available reviewer agent under the
 * self-managed model, else the human rule of §7.4.2 (D-75).
 */
export async function chooseAssignee(tx: Prisma.TransactionClient, submitterId: string) {
  const { model, agent } = await agentFacts(tx);
  const candidates = await tx.user.findMany({
    where: {
      kind: 'human',
      disabledAt: null,
      roles: { hasSome: ['owner', 'publisher', 'reviewer'] },
    },
    select: { id: true, kind: true, roles: true, disabledAt: true, createdAt: true },
  });
  return pickReviewer(
    model,
    agent,
    candidates.map((u) => ({
      id: u.id,
      kind: u.kind,
      roles: u.roles,
      disabled: u.disabledAt !== null,
      createdAt: u.createdAt.getTime(),
    })),
    submitterId,
  );
}

/** Open the assignment of a new proposal in its insert transaction. `null` = nobody to ask yet. */
export async function openAssignment(
  tx: Prisma.TransactionClient,
  proposal: { id: string; submitterId: string },
  actor: { id: string; kind: 'human' | 'agent' } | null,
) {
  const pick = await chooseAssignee(tx, proposal.submitterId);
  if (!pick) return null;
  const row = await tx.assignment.create({
    data: { proposalId: proposal.id, assigneeId: pick.id, reason: pick.reason },
  });
  await audit(tx, actor, 'proposal.assigned', 'proposal', proposal.id, {
    assigneeId: pick.id,
    reason: pick.reason,
  });
  return row;
}

/**
 * The proposal left `pending` (decision, withdrawal, conflict resolution): every open assignment
 * closes and every open escalation is resolved (§7.8.5).
 */
export async function closeAssignments(
  tx: Prisma.TransactionClient,
  proposalId: string,
  now: Date,
  resolution: 'decided' | 'withdrawn' = 'decided',
) {
  await tx.escalation.updateMany({
    where: { proposalId, resolvedAt: null },
    data: { resolvedAt: now, resolution },
  });
  return tx.assignment.updateMany({
    where: { proposalId, closedAt: null },
    data: { closedAt: now },
  });
}
