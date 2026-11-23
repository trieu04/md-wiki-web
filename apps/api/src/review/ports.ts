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

/**
 * Mandatory escalation triggers that refuse an agent approval (system-logic §7.8.3). `firing`
 * runs in the decision transaction; `gate` refuses any decision while the actor is a paused
 * reviewer agent (D-211). Phase 8 provides `MandatoryTriggers` (apps/api/src/agent).
 */
export interface EscalationTriggers {
  firing(
    tx: Prisma.TransactionClient,
    proposal: Proposal,
    actor: { id: string; kind: 'human' | 'agent' },
  ): Promise<{ id: string; detail: string }[]>;
  gate?(tx: Prisma.TransactionClient, actor: { id: string }): Promise<string | null>;
}
export const ESCALATION_TRIGGERS = Symbol('ESCALATION_TRIGGERS');
export class NoTriggers implements EscalationTriggers {
  firing() {
    return Promise.resolve([]);
  }
}

/** After a publication reached `done` (Phase 8: digest to page authors, spot-check sampling). */
export interface AfterPublish {
  published(proposalId: string): Promise<void>;
}
export const AFTER_PUBLISH = Symbol('AFTER_PUBLISH');

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

/**
 * Phase 9 port (system-logic §7.7.3, §7.7.6, §7.7.9): credibility work at publish finish —
 * anchor links for pure renames, reports fixed by the new version, `section_edited` notices and
 * the contributor's auto-follow. `published` runs inside the finish transaction.
 */
export interface PublishedVersion {
  publicationId: string;
  proposalId: string;
  path: string;
  section: string | null;
  versionLabel: string;
  baseVersionLabel: string | null;
  submitterId: string;
  reviewerId: string;
}
export interface PublishListener {
  published(tx: Prisma.TransactionClient, version: PublishedVersion): Promise<void>;
}
export const PUBLISH_LISTENER = Symbol('PUBLISH_LISTENER');
export class NoListener implements PublishListener {
  published() {
    return Promise.resolve();
  }
}
