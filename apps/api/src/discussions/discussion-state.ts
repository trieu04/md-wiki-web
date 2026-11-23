import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DiscussionFacts, DiscussionState } from '../review/ports.js';
import { stateOf } from './discussions.service.js';

/**
 * The real Phase 6 port (replaces the Phase 5 stub, D-91): versions and blockers read from
 * `Topic` (the proposal's discussion) and `DisputeEvent` inside the caller's transaction.
 */
@Injectable()
export class PrismaDiscussionState implements DiscussionState {
  state(tx: Prisma.TransactionClient, proposalId: string): Promise<DiscussionFacts> {
    return stateOf(tx, proposalId);
  }
}
