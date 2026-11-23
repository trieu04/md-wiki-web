import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { composeProposed, regionOf } from './draft.js';
import type { ErrorCode } from './errors.js';
import type { ReviewerKind } from './labels.js';
import type { Role } from './permissions.js';
import { ok, type Result } from './result.js';
import { splitSections } from './sections.js';
import { parseStatusBlock, renderStatusBlock } from './status-block.js';

/** Review and publish rules (system-logic §7.4). Pure: no IO, no clock. */

export type ProposalState = 'pending' | 'approved' | 'published' | 'rejected' | 'stale';
export type PublicationPhase =
  'prepared' | 'writing' | 'written' | 'done' | 'unknown' | 'stale' | 'not_written';
export type ProposalTab = 'open' | 'stale' | 'blocked' | 'published' | 'rejected';
export const PROPOSAL_TABS = ['open', 'stale', 'blocked', 'published', 'rejected'] as const;
/** Phases during which a publication holds its target (one per target, D-78). */
export const OPEN_PHASES = ['prepared', 'writing', 'written', 'unknown'] as const;

export function reviewerKindOf(kind: 'human' | 'agent'): ReviewerKind {
  return kind === 'agent' ? 'agent' : 'person';
}

/**
 * Deterministic decision id (D-76): the preview prints it in the status block before the
 * decision exists, and a replayed decision maps to the same row. UUID version 8, RFC 4122 variant.
 */
export function decisionId(proposalId: string, reviewerId: string, previewAt: string): string {
  const bytes = sha256(
    utf8ToBytes(`md-wiki:decision\0${proposalId}\0${reviewerId}\0${previewAt}`),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface ArtifactInput {
  slug: string;
  decisionId: string;
  reviewerKind: ReviewerKind;
  previewAt: string;
}

/** The exact bytes that publishing writes: status block, then the frozen proposed bytes. */
export function renderArtifact(input: ArtifactInput, proposed: Uint8Array): Uint8Array {
  const head = utf8ToBytes(
    renderStatusBlock({
      proposal: input.slug,
      decision: input.decisionId,
      reviewer: input.reviewerKind,
      decided_at: input.previewAt,
    }),
  );
  const out = new Uint8Array(head.length + proposed.length);
  out.set(head, 0);
  out.set(proposed, head.length);
  return out;
}

export function artifactHash(input: ArtifactInput, proposed: Uint8Array): string {
  return bytesToHex(sha256(renderArtifact(input, proposed)));
}

export interface AssigneeCandidate {
  id: string;
  kind: 'human' | 'agent';
  roles: readonly Role[];
  disabled: boolean;
  /** Epoch ms; only the order matters. */
  createdAt: number;
}

function byAge(a: AssigneeCandidate, b: AssigneeCandidate) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Who decides a proposal until Phase 8 (D-75): the first enabled human owner who did not
 * submit it; else the first enabled human publisher, then reviewer; else nobody.
 */
export function pickAssignee(
  candidates: readonly AssigneeCandidate[],
  submitterId: string,
): { id: string; reason: 'owner' | 'fallback_reviewer' } | null {
  const eligible = candidates
    .filter((c) => c.kind === 'human' && !c.disabled && c.id !== submitterId)
    .sort(byAge);
  const owner = eligible.find((c) => c.roles.includes('owner'));
  if (owner) return { id: owner.id, reason: 'owner' };
  for (const role of ['publisher', 'reviewer'] as const) {
    const found = eligible.find((c) => c.roles.includes(role));
    if (found) return { id: found.id, reason: 'fallback_reviewer' };
  }
  return null;
}

/** F-09 tab of a proposal (D-87). */
export function tabOf(state: ProposalState, latestPhase: PublicationPhase | null): ProposalTab {
  if (state === 'approved') return latestPhase === 'unknown' ? 'blocked' : 'open';
  if (state === 'pending') return 'open';
  return state;
}

export interface DecisionFacts {
  approve: boolean;
  state: ProposalState;
  hasOpenAssignment: boolean;
  isOwnProposal: boolean;
  disputed: boolean;
  bindingMatches: boolean;
  versionsMatch: boolean;
  targetFresh: boolean;
  sourcesFresh: boolean;
  targetBlocked: boolean;
  isAgent: boolean;
  firingTriggers: readonly string[];
}

/** Steps 4–12 of system-logic §7.4.3, in order; `null` when the decision may be recorded. */
export function decisionGuard(f: DecisionFacts): ErrorCode | null {
  if (f.state !== 'pending') return 'PRECONDITION_FAILED';
  if (!f.hasOpenAssignment) return 'NOT_ASSIGNED';
  if (f.isOwnProposal) return 'SELF_REVIEW';
  if (f.approve && f.disputed) return 'DISPUTED';
  if (!f.bindingMatches) return 'DECISION_BINDING_MISMATCH';
  if (!f.versionsMatch) return 'DISCUSSION_CHANGED';
  if (f.approve && !f.targetFresh) return 'STALE_BASE';
  if (f.approve && !f.sourcesFresh) return 'SOURCE_CHANGED';
  if (f.approve && f.targetBlocked) return 'TARGET_BLOCKED';
  if (f.approve && f.isAgent && f.firingTriggers.length > 0) return 'ESCALATION_REQUIRED';
  return null;
}

/** Outcome of a failed conditional write (D-79). `readBackSha` null = absent or unreadable. */
export function classifyWriteFailure(
  code: string | null,
  readBackSha: string | null,
  expectedArtifactHash: string,
): 'stale' | 'written' | 'unknown' {
  if (code === 'PRECONDITION_FAILED' || code === 'ALREADY_EXISTS') return 'stale';
  if (code === 'VERIFY_FAILED') return 'unknown';
  return readBackSha === expectedArtifactHash ? 'written' : 'unknown';
}

/** What the blocked target's file holds (F-13). */
export function diskMatch(
  diskSha: string | null,
  artifactSha: string,
  baseSha: string | null,
): 'new' | 'old' | 'neither' | 'missing' {
  if (diskSha === null) return baseSha === null ? 'old' : 'missing';
  if (diskSha === artifactSha) return 'new';
  return diskSha === baseSha ? 'old' : 'neither';
}

/** D-80: the file's bytes carry the decision id, so they settle which outcome is possible. */
export function resolutionAllowed(
  outcome: 'written' | 'not_written',
  diskSha: string | null,
  artifactSha: string,
): boolean {
  return outcome === 'written' ? diskSha === artifactSha : diskSha !== artifactSha;
}

export interface ConflictView {
  scope: 'section' | 'page';
  baseText: string;
  currentText: string;
  proposedText: string;
}

/**
 * The three panes of a conflict (system-logic §7.4.7): the section region when the proposal is
 * section-scoped and that section exists in all three versions, else the whole bodies.
 */
export function conflictView(
  base: string | null,
  current: string | null,
  proposed: string,
  section: string | null,
): ConflictView {
  if (section !== null && base !== null && current !== null) {
    const [b, c, p] = [
      regionOf(base, section),
      regionOf(current, section),
      regionOf(proposed, section),
    ];
    if (b && c && p)
      return { scope: 'section', baseText: b.text, currentText: c.text, proposedText: p.text };
  }
  const body = (md: string | null) => (md === null ? '' : parseStatusBlock(md).body);
  return {
    scope: 'page',
    baseText: body(base),
    currentText: body(current),
    proposedText: body(proposed),
  };
}

/** Splice a conflict replacement into the current version (the new proposal's body). */
export function composeReplacement(
  current: string | null,
  view: Pick<ConflictView, 'scope'>,
  section: string | null,
  replacement: string,
): Result<string, 'UNKNOWN_SECTION'> {
  if (view.scope === 'section' && section !== null)
    return composeProposed(current, section, replacement);
  return current === null ? ok(replacement) : composeProposed(current, null, replacement);
}

/** Anchors and hashes recorded for a published artifact (PublishedSection rows, D-83). */
export function publishedSections(artifact: string): { anchor: string; sectionHash: string }[] {
  return splitSections(artifact).map((s) => ({ anchor: s.anchor, sectionHash: s.hash }));
}

/** `previewAt` must be a canonical UTC instant no later than `now + skewMs`. */
export function validPreviewAt(previewAt: string, now: number, skewMs = 5000): boolean {
  const t = Date.parse(previewAt);
  if (!Number.isFinite(t)) return false;
  if (new Date(t).toISOString() !== previewAt) return false;
  return t <= now + skewMs;
}
