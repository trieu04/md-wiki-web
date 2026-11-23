import type { ErrorCode } from './errors.js';

/**
 * Discussions (system-logic §7.5): topic and dispute-log rules. Ported from md-wiki
 * `core/discussions.py` (`close_topic`, `resolve_discussion`, `discuss`, `semantic_discussion`).
 * Pure: the API loads the facts inside the locked transaction and asks these functions.
 */

export const TOPIC_STATUSES = ['open', 'on_hold', 'resolved', 'rejected'] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];
export const CLOSE_OUTCOMES = ['resolved', 'rejected', 'on_hold'] as const;
export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];
export const ENTRY_KINDS = ['open', 'comment', 'agreement', 'close', 'reopen'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const DISPUTE_ACTIONS = ['open', 'comment', 'resolve', 'reopen'] as const;
export type DisputeAction = (typeof DISPUTE_ACTIONS)[number];
export const DISPUTE_RESOLUTIONS = ['supported', 'scoped', 'attributed', 'not_a_conflict'] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];
export const TOPIC_FILTERS = ['open', 'mine', 'closed', 'all'] as const;
export type TopicFilter = (typeof TOPIC_FILTERS)[number];

/** Statuses that accept replies (md-wiki: a closed discussion must be reopened first). */
export const isActive = (status: TopicStatus) => status === 'open' || status === 'on_hold';
/** The filter tab a topic belongs to besides `all` (`mine` is per viewer). */
export const topicTab = (status: TopicStatus): 'open' | 'closed' =>
  isActive(status) ? 'open' : 'closed';

/**
 * A proposal topic holds approval unless it was resolved: `rejected` records that the debate
 * went against the proposal and `on_hold` keeps it open (md-wiki `discussion_hold`).
 */
export const holdsApproval = (topic: { proposalId: string | null; status: TopicStatus } | null) =>
  topic !== null && topic.proposalId !== null && topic.status !== 'resolved';

export type TopicAction =
  { kind: 'comment' | 'agreement' } | { kind: 'close'; outcome: CloseOutcome } | { kind: 'reopen' };

/** Status after an action, or `PRECONDITION_FAILED` when the transition is not allowed. */
export function topicTransition(
  status: TopicStatus,
  action: TopicAction,
): { ok: true; status: TopicStatus } | { ok: false; code: ErrorCode; detail: string } {
  const fail = (detail: string) => ({
    ok: false as const,
    code: 'PRECONDITION_FAILED' as const,
    detail,
  });
  switch (action.kind) {
    case 'comment':
    case 'agreement':
      return isActive(status)
        ? { ok: true, status }
        : fail('The topic is closed; reopen it before replying');
    case 'close':
      if (!isActive(status)) return fail('The topic is already closed');
      if (action.outcome === 'on_hold' && status === 'on_hold')
        return fail('The topic is already on hold');
      return { ok: true, status: action.outcome };
    case 'reopen':
      return status === 'open' ? fail('The topic is already open') : { ok: true, status: 'open' };
  }
}

/**
 * Who may close or reopen (D-108): on a proposal topic a reviewer who did not submit the
 * proposal (md-wiki `check_reviewer`); on any other topic its author or a reviewer.
 */
export function mayCloseTopic(f: {
  isProposalTopic: boolean;
  isAuthor: boolean;
  isReviewer: boolean;
  isSubmitter: boolean;
}): ErrorCode | null {
  if (f.isProposalTopic) {
    if (!f.isReviewer) return 'FORBIDDEN';
    if (f.isSubmitter) return 'SELF_REVIEW';
    return null;
  }
  return f.isAuthor || f.isReviewer ? null : 'FORBIDDEN';
}

/** `agreesWith` must point at an earlier entry of the topic (md-wiki `add_discussion_message`). */
export function validAgreement(agreesWith: number, version: number): boolean {
  return Number.isInteger(agreesWith) && agreesWith >= 1 && agreesWith <= version;
}

export interface DisputeEventFact {
  seq: number;
  action: DisputeAction;
}
/** Version = last sequence; disputed = the last open/reopen is not followed by a resolve. */
export function disputeState(events: readonly DisputeEventFact[]): {
  version: number;
  disputed: boolean;
} {
  let disputed = false;
  let version = 0;
  for (const e of events) {
    version = Math.max(version, e.seq);
    if (e.action === 'open' || e.action === 'reopen') disputed = true;
    else if (e.action === 'resolve') disputed = false;
  }
  return { version, disputed };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Checks for one dispute-log entry after the version matched (md-wiki `discuss`).
 * Returns the error code with a message, or null.
 */
export function disputeStep(
  events: readonly DisputeEventFact[],
  input: { action: DisputeAction; resolutionKind: string | null; relatedSlugs: readonly string[] },
): { code: ErrorCode; detail: string; field?: string } | null {
  const { disputed } = disputeState(events);
  if (input.action === 'resolve') {
    if (!(DISPUTE_RESOLUTIONS as readonly string[]).includes(input.resolutionKind ?? ''))
      return {
        code: 'VALIDATION_FAILED',
        detail: 'resolution kind required',
        field: 'resolutionKind',
      };
  } else if (input.resolutionKind !== null)
    return {
      code: 'VALIDATION_FAILED',
      detail: 'resolution kind is only valid for resolve',
      field: 'resolutionKind',
    };
  const related = input.relatedSlugs;
  if (
    related.length > 50 ||
    new Set(related).size !== related.length ||
    related.some((s) => !SLUG.test(s) || s.length > 80)
  )
    return {
      code: 'VALIDATION_FAILED',
      detail: 'related proposals must be unique valid slugs (at most 50)',
      field: 'relatedSlugs',
    };
  if (input.action === 'open' && events.length > 0)
    return { code: 'PRECONDITION_FAILED', detail: 'use reopen for a previously recorded dispute' };
  if (input.action === 'reopen' && (events.length === 0 || disputed))
    return { code: 'PRECONDITION_FAILED', detail: 'only a resolved dispute can be reopened' };
  if ((input.action === 'comment' || input.action === 'resolve') && !disputed)
    return {
      code: 'PRECONDITION_FAILED',
      detail: 'open a dispute before commenting or resolving',
    };
  return null;
}

/** Approval blockers seen by the decision (§7.4.3 step 7) and the binding versions (step 9). */
export function discussionSummary(
  topic: { proposalId: string | null; status: TopicStatus; version: number } | null,
  disputes: readonly DisputeEventFact[],
) {
  const d = disputeState(disputes);
  const held = holdsApproval(topic);
  return {
    discussionVersion: topic?.version ?? 0,
    disputeVersion: d.version,
    held,
    disputeOpen: d.disputed,
    disputed: held || d.disputed,
  };
}
