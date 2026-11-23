import type { Prisma, Proposal } from '@prisma/client';

/**
 * Phase 6 port (system-logic §7.4.3, D-91): proposal discussion and dispute versions. Reads run
 * inside the decision transaction after the proposal row is locked; Phase 6 writers take the same
 * row lock, so a discussion entry and a decision serialize.
 */
export interface DiscussionState {
  state(tx: Prisma.TransactionClient, proposalId: string): Promise<DiscussionFacts>;
}
export interface DiscussionFacts {
  discussionVersion: number;
  disputeVersion: number;
  /** held or disputeOpen: approval is refused with DISPUTED. */
  disputed: boolean;
  held: boolean;
  disputeOpen: boolean;
  topicId: string | null;
}
export const DISCUSSION_STATE = Symbol('DISCUSSION_STATE');

/** Phase 8 port: mandatory escalation triggers that refuse an agent approval (none yet). */
export interface EscalationTriggers {
  firing(
    tx: Prisma.TransactionClient,
    proposal: Proposal,
    actor: { id: string; kind: 'human' | 'agent' },
  ): Promise<string[]>;
}
export const ESCALATION_TRIGGERS = Symbol('ESCALATION_TRIGGERS');
export class NoTriggers implements EscalationTriggers {
  firing() {
    return Promise.resolve([]);
  }
}

/**
 * Crash points of the publish flow (system-logic §7.4.5). Production hooks do nothing; fault
 * tests throw from a point to simulate the process dying there (the flow never catches it).
 */
export type CrashPoint = 'approved' | 'prepared' | 'writing' | 'afterWrite' | 'written';
export interface PublishHooks {
  at(point: CrashPoint, proposalId: string): void | Promise<void>;
}
export const PUBLISH_HOOKS = Symbol('PUBLISH_HOOKS');
export class NoHooks implements PublishHooks {
  at() {
    return undefined;
  }
}
