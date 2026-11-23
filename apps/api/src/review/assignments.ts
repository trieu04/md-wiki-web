import { pickAssignee } from '@md-wiki/domain';
import type { Prisma } from '@prisma/client';
import { audit } from '../auth/credentials.js';

/** The assignment rule until Phase 8 (system-logic §7.4.2, D-75). */
export async function chooseAssignee(tx: Prisma.TransactionClient, submitterId: string) {
  const candidates = await tx.user.findMany({
    where: {
      kind: 'human',
      disabledAt: null,
      roles: { hasSome: ['owner', 'publisher', 'reviewer'] },
    },
    select: { id: true, kind: true, roles: true, disabledAt: true, createdAt: true },
  });
  return pickAssignee(
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

export function closeAssignments(tx: Prisma.TransactionClient, proposalId: string, now: Date) {
  return tx.assignment.updateMany({
    where: { proposalId, closedAt: null },
    data: { closedAt: now },
  });
}
