import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { pickAssignee, type AssigneeCandidate } from './review.js';

/** Self-managed review rules (system-logic §7.8). Pure: no IO, no clock. */

export type ReviewModel = 'self_managed' | 'human';
export const AGENT_FAILURE_CAP = 3;
export const SPOT_CHECK_DEFAULT = 0.1;
export const REMINDER_DAYS_DEFAULT = 2;

export interface AgentFacts {
  id: string;
  /** Enabled, and holds a live token with scope `review` (D-200). */
  available: boolean;
}

/**
 * Who reviews a new proposal (D-201): the reviewer agent under the self-managed model when it
 * is available and did not submit the proposal (paused still counts: proposals wait for it);
 * else the human rule of D-75.
 */
export function pickReviewer(
  model: ReviewModel,
  agent: AgentFacts | null,
  candidates: readonly AssigneeCandidate[],
  submitterId: string,
): { id: string; reason: 'agent' | 'owner' | 'fallback_reviewer' } | null {
  if (model === 'self_managed' && agent?.available && agent.id !== submitterId)
    return { id: agent.id, reason: 'agent' };
  return pickAssignee(candidates, submitterId);
}

/**
 * Deterministic spot-check sampling (D-213): the first 32 bits of SHA-256("md-wiki:spot\0" +
 * decision id) as a fraction of 2^32 is below the rate. Auditable and replay-safe.
 */
export function spotCheckSampled(decisionId: string, rate: number): boolean {
  if (!(rate > 0)) return false;
  if (rate >= 1) return true;
  const hex = bytesToHex(sha256(utf8ToBytes(`md-wiki:spot\0${decisionId}`))).slice(0, 8);
  return parseInt(hex, 16) / 2 ** 32 < rate;
}

export type AgentRunTrigger = 'after_check' | 'returned' | 'resumed';
export interface AgentRunFacts {
  model: ReviewModel;
  paused: boolean;
  agentAvailable: boolean;
  state: string;
  /** createdAt (ms) of the agent's open assignment, or null when it holds none. */
  assignedAt: number | null;
  /** Latest `proposal.returned` / `proposal.discussion_closed` (ms), or null. */
  returnedAt: number | null;
  /** A quality_check run of the proposal is queued/running within its lease. */
  qualityActive: boolean;
  /** agent_review jobs of the proposal (any status), with createdAt ms. */
  runs: readonly { status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: number }[];
}

/**
 * Whether the agent owes a review now (D-209), and with which trigger. A round starts when the
 * agent is assigned or the proposal is returned to it; one non-failed run per round, at most
 * AGENT_FAILURE_CAP failed ones; never while a run or a quality check is active.
 */
export function agentRunDue(f: AgentRunFacts): AgentRunTrigger | null {
  if (f.model !== 'self_managed' || f.paused || !f.agentAvailable) return null;
  if (f.state !== 'pending' || f.assignedAt === null || f.qualityActive) return null;
  if (f.runs.some((r) => r.status === 'queued' || r.status === 'running')) return null;
  const roundStart = Math.max(f.assignedAt, f.returnedAt ?? 0);
  const inRound = f.runs.filter((r) => r.createdAt >= roundStart);
  if (inRound.some((r) => r.status === 'succeeded')) return null;
  if (inRound.filter((r) => r.status === 'failed').length >= AGENT_FAILURE_CAP) return null;
  if (!f.runs.length) return 'after_check';
  return f.returnedAt !== null && f.returnedAt >= f.assignedAt ? 'returned' : 'resumed';
}

/** Reminder due (D-212): `reminderDays` after creation or the last reminder. Never decides. */
export function reminderDue(
  escalation: { createdAt: number; lastRemindedAt: number | null; resolved: boolean },
  reminderDays: number,
  now: number,
): boolean {
  if (escalation.resolved || reminderDays <= 0) return false;
  return now - (escalation.lastRemindedAt ?? escalation.createdAt) >= reminderDays * 86_400_000;
}

export const INBOX_TABS = ['all', 'decide', 'check', 'spot', 'mentions', 'done'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];
export type InboxKind = 'review' | 'rereview' | 'discussion' | 'spot_check' | 'mention' | 'check';
export const tabOfInboxKind = (kind: InboxKind): Exclude<InboxTab, 'all' | 'done'> =>
  kind === 'spot_check'
    ? 'spot'
    : kind === 'mention'
      ? 'mentions'
      : kind === 'check'
        ? 'check'
        : 'decide';

export interface InboxEntry {
  id: string;
  kind: InboxKind;
  done: boolean;
  at: number;
}

/** Counts per tab (D-215): `all` = every open item; `done` = finished items. */
export function inboxCounts(entries: readonly InboxEntry[]): Record<InboxTab, number> {
  const counts: Record<InboxTab, number> = {
    all: 0,
    decide: 0,
    check: 0,
    spot: 0,
    mentions: 0,
    done: 0,
  };
  for (const e of entries) {
    if (e.done) counts.done++;
    else {
      counts.all++;
      counts[tabOfInboxKind(e.kind)]++;
    }
  }
  return counts;
}

/** Entries of a tab, newest first (`at desc, id desc`). */
export function inboxTab<E extends InboxEntry>(entries: readonly E[], tab: InboxTab): E[] {
  return entries
    .filter((e) =>
      tab === 'done' ? e.done : !e.done && (tab === 'all' || tabOfInboxKind(e.kind) === tab),
    )
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
