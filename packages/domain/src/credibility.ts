import { sectionHash } from './sections.js';
import type { Label, LabelThreshold, ReviewerKind, SectionLabelInput } from './labels.js';

/**
 * Pure credibility rules (system-logic §7.7): cited sources, source tiers, anchor relinking,
 * page authors, attestation rules, retention, reciprocal pairs, propagation, gates, notifications.
 * Nothing here reads a clock: callers pass `now`/`today`.
 */

export const ATTEST_KINDS = ['useful', 'checked', 'used'] as const;
export type AttestKind = (typeof ATTEST_KINDS)[number];
export const REPORT_KINDS = ['wrong', 'outdated', 'unclear', 'source', 'other'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const CHECK_RESULTS = ['supports', 'partly', 'contradicts', 'unverifiable'] as const;
export const SOURCE_CHECK_RESULTS = ['supported', 'not_supported', 'unverifiable'] as const;
export type SourceCheckResult = (typeof SOURCE_CHECK_RESULTS)[number];
export const USE_KINDS = ['acquisition', 'analysis', 'training', 'protocol', 'other'] as const;
export const WORKED = ['yes', 'with_changes', 'no'] as const;
export const FEEDBACK_ANSWERS = ['yes', 'partly', 'no'] as const;
export const EDGE_KINDS = ['copy', 'corroborates', 'contradicts', 'lab_data'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];
export const INVALIDATION_KINDS = [
  'retraction',
  'concern',
  'source_changed',
  'version_changed',
  'contradiction',
  'root_wrong',
] as const;
export type InvalidationKind = (typeof INVALIDATION_KINDS)[number];
/** Invalidations that make earlier evidence on the same source ref stop counting (D-162). */
export const INVALIDATING: ReadonlySet<InvalidationKind> = new Set([
  'retraction',
  'source_changed',
  'root_wrong',
]);
/** Report undo window shown to the reader (ux.md §4 "Undo (10 min)"). */
export const UNDO_MS = 10 * 60_000;
export const REPORT_LIMIT = { count: 5, days: 7 } as const;
export const RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

// ---- cited sources (D-176) --------------------------------------------------------------------

const DOI = /\b(10\.\d{4,9}\/[^\s"<>)\]]+)/gi;
const LINK = /\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>|(?:^|[\s(])(https?:\/\/[^\s<>)\]]+)/gi;

function trimRef(value: string): string {
  return value.replace(/[.,;:]+$/, '');
}

/** `doi:<doi>` (lower case), `url:<url without fragment>`, else the trimmed free text. */
export function normalizeSourceRef(raw: string): string {
  const value = raw.trim();
  const prefixed = /^(doi|url):(.*)$/i.exec(value);
  if (prefixed?.[1] && prefixed[2] !== undefined) {
    return prefixed[1].toLowerCase() === 'doi'
      ? `doi:${trimRef(prefixed[2].trim()).toLowerCase()}`
      : `url:${trimRef(prefixed[2].trim()).replace(/#.*$/, '')}`;
  }
  const doi = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i.exec(value);
  if (doi?.[1]) return `doi:${trimRef(doi[1]).toLowerCase()}`;
  if (/^https?:\/\//i.test(value)) return `url:${trimRef(value).replace(/#.*$/, '')}`;
  return value;
}

/** External sources cited by a section's text, deduplicated in order of appearance. */
export function citedSources(text: string): string[] {
  const found: { at: number; ref: string }[] = [];
  const dois = new Set<string>();
  for (const m of text.matchAll(DOI)) {
    const ref = normalizeSourceRef(m[1] ?? '');
    dois.add(ref);
    found.push({ at: m.index, ref });
  }
  for (const m of text.matchAll(LINK)) {
    const url = m[1] ?? m[2] ?? m[3];
    if (!url) continue;
    const ref = normalizeSourceRef(url);
    if (ref.startsWith('doi:') && dois.has(ref)) continue;
    found.push({ at: m.index, ref });
  }
  found.sort((a, b) => a.at - b.at);
  return [...new Set(found.map((f) => f.ref))];
}

/** Wiki pages a text links to (blast radius only; links never count as evidence). */
export function linkedPaths(text: string, fromPath: string): string[] {
  const out = new Set<string>();
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
    const target = (m[1] ?? '').trim();
    if (target) out.add(target.endsWith('.md') ? target : `${target}.md`);
  }
  for (const m of text.matchAll(/\]\(\s*<?([^\s)>#?]+\.md)(?:[#?][^\s)>]*)?>?\s*\)/g)) {
    const target = m[1] ?? '';
    if (/^[a-z]+:/i.test(target)) continue;
    const joined = target.startsWith('/') ? target.slice(1) : dir + target;
    const parts: string[] = [];
    for (const part of joined.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
    }
    out.add(parts.join('/'));
  }
  out.delete(fromPath);
  return [...out];
}

// ---- source tiers (D-175) ---------------------------------------------------------------------

export const SOURCE_TIERS = ['high', 'medium', 'low'] as const;
export type SourceTierLevel = (typeof SOURCE_TIERS)[number];
export interface SourceTier {
  source: string;
  match: string;
  tier: SourceTierLevel;
  reason: string;
  reviewed: string | null;
  line: number;
}
export type TierWarningCode =
  | 'NO_TABLE'
  | 'MISSING_COLUMN'
  | 'BAD_TIER'
  | 'BAD_DATE'
  | 'DUPLICATE_MATCH'
  | 'STALE_REVIEW';
export interface TierWarning {
  line: number;
  code: TierWarningCode;
  message: string;
}
const TIER_COLUMNS = ['source', 'match', 'tier', 'reason', 'reviewed'] as const;
export const STALE_TIER_YEARS = 4;

function cells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Parse `wiki-meta/source-tiers.md`; never throws (warnings instead). */
export function parseSourceTiers(
  markdown: string,
  today: Date,
): { tiers: SourceTier[]; warnings: TierWarning[] } {
  const lines = markdown.split(/\r\n|\r|\n/);
  const warnings: TierWarning[] = [];
  const tiers: SourceTier[] = [];
  let header: Map<string, number> | null = null;
  let headerLine = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const row = cells(lines[i] ?? '');
    const next = cells(lines[i + 1] ?? '');
    if (row && next?.every((c) => /^:?-{1,}:?$/.test(c))) {
      header = new Map(row.map((c, n) => [c.toLowerCase(), n]));
      headerLine = i + 1;
      i += 2;
      break;
    }
  }
  if (!header) {
    warnings.push({ line: 0, code: 'NO_TABLE', message: 'No source tier table found' });
    return { tiers, warnings };
  }
  const missing = TIER_COLUMNS.filter((c) => !header.has(c));
  if (missing.length) {
    warnings.push({
      line: headerLine,
      code: 'MISSING_COLUMN',
      message: `Missing column(s): ${missing.join(', ')}`,
    });
    if (!header.has('match') || !header.has('tier')) return { tiers, warnings };
  }
  const col = (row: string[], name: string) => {
    const n = header.get(name);
    return n === undefined ? '' : (row[n] ?? '');
  };
  const seen = new Set<string>();
  const staleBefore = new Date(today.getTime());
  staleBefore.setUTCFullYear(staleBefore.getUTCFullYear() - STALE_TIER_YEARS);
  for (; i < lines.length; i++) {
    const row = cells(lines[i] ?? '');
    if (!row) break;
    const line = i + 1;
    const match = normalizeSourceRef(col(row, 'match'));
    const tier = col(row, 'tier').toLowerCase();
    if (!match) continue;
    if (!(SOURCE_TIERS as readonly string[]).includes(tier)) {
      warnings.push({ line, code: 'BAD_TIER', message: `Unknown tier "${tier}"` });
      continue;
    }
    if (seen.has(match)) {
      warnings.push({ line, code: 'DUPLICATE_MATCH', message: `Duplicate match ${match}` });
      continue;
    }
    seen.add(match);
    const reviewedText = col(row, 'reviewed');
    let reviewed: string | null = null;
    if (reviewedText) {
      if (!isCalendarDate(reviewedText))
        warnings.push({ line, code: 'BAD_DATE', message: `Bad review date "${reviewedText}"` });
      else {
        reviewed = reviewedText;
        if (new Date(`${reviewedText}T00:00:00Z`) < staleBefore)
          warnings.push({
            line,
            code: 'STALE_REVIEW',
            message: `Tier of ${match} was last reviewed more than ${String(STALE_TIER_YEARS)} years ago`,
          });
      }
    }
    tiers.push({
      source: col(row, 'source'),
      match,
      tier: tier as SourceTierLevel,
      reason: col(row, 'reason'),
      reviewed,
      line,
    });
  }
  return { tiers, warnings };
}

/** Longest matching prefix wins. */
export function tierOf(ref: string, tiers: readonly SourceTier[]): SourceTier | null {
  let best: SourceTier | null = null;
  for (const t of tiers)
    if (ref.startsWith(t.match) && (!best || t.match.length > best.match.length)) best = t;
  return best;
}

// ---- anchor relinking (D-163) -----------------------------------------------------------------

export interface SectionShape {
  anchor: string;
  level: number;
  text: string;
  hash: string;
}
/** Hash of the section text without its heading line (the lead has none). */
export function bodyHash(section: Pick<SectionShape, 'level' | 'text'>): string {
  if (section.level === 0) return sectionHash(section.text);
  const lines = section.text.split(/\r\n|\r|\n/);
  // A setext heading spans two lines (title + underline).
  const skip = lines.length > 1 && /^\s*(=+|-+)\s*$/.test(lines[1] ?? '') && !/^#/.test(lines[0] ?? '') ? 2 : 1;
  return sectionHash(lines.slice(skip).join('\n'));
}
export interface AnchorRename {
  oldAnchor: string;
  oldHash: string;
  newAnchor: string;
  newHash: string;
}
/** Pure renames: equal bodies, old anchor gone, new anchor new, one-to-one. */
export function detectRenames(
  before: readonly SectionShape[],
  after: readonly SectionShape[],
): AnchorRename[] {
  const beforeAnchors = new Set(before.map((s) => s.anchor));
  const afterAnchors = new Set(after.map((s) => s.anchor));
  const gone = before.filter((s) => !afterAnchors.has(s.anchor) && s.level > 0);
  const added = after.filter((s) => !beforeAnchors.has(s.anchor) && s.level > 0);
  const byBody = (list: readonly SectionShape[]) => {
    const map = new Map<string, SectionShape[]>();
    for (const s of list) {
      const key = bodyHash(s);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  };
  const goneBy = byBody(gone);
  const addedBy = byBody(added);
  const out: AnchorRename[] = [];
  for (const [key, olds] of goneBy) {
    const news = addedBy.get(key);
    const [o] = olds;
    const [n] = news ?? [];
    if (olds.length === 1 && news?.length === 1 && o && n)
      out.push({ oldAnchor: o.anchor, oldHash: o.hash, newAnchor: n.anchor, newHash: n.hash });
  }
  return out.sort((a, b) => (a.newAnchor < b.newAnchor ? -1 : 1));
}
export interface SectionKey {
  path: string;
  anchor: string;
  sectionHash: string;
}
export const sectionKeyOf = (k: SectionKey) => `${k.path}\0${k.anchor}\0${k.sectionHash}`;
/** Every older key whose evidence follows `key` through anchor links (cycle-safe). */
export function aliasKeys(
  key: SectionKey,
  links: readonly (AnchorRename & { path: string })[],
): SectionKey[] {
  const out: SectionKey[] = [];
  const seen = new Set([sectionKeyOf(key)]);
  const queue = [key];
  for (let k = queue.shift(); k; k = queue.shift()) {
    for (const l of links) {
      if (l.path !== k.path || l.newAnchor !== k.anchor || l.newHash !== k.sectionHash) continue;
      const old = { path: l.path, anchor: l.oldAnchor, sectionHash: l.oldHash };
      if (seen.has(sectionKeyOf(old))) continue;
      seen.add(sectionKeyOf(old));
      out.push(old);
      queue.push(old);
    }
  }
  return out;
}

// ---- attestations (D-166, D-167) --------------------------------------------------------------

export type AttestationEventStatus =
  | 'withdrawn'
  | 'confirmed'
  | 'confirmed_error'
  | 'dismissed'
  | 'fixed'
  | 'downweighted';
export type AttestationState =
  | 'active'
  | 'withdrawn'
  | 'on_old_version'
  | 'stale'
  | 'downweighted'
  | 'open'
  | 'confirmed'
  | 'confirmed_error'
  | 'dismissed'
  | 'fixed';
export interface FieldIssue {
  path: string;
  code: string;
  message: string;
}

/** Cross-field rules of `AttestationInput` (DTO validation handles types and lengths). */
export function attestationIssues(input: {
  kind: AttestKind;
  checked?: unknown;
  used?: { worked: string; change?: string | undefined } | undefined;
}): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (input.kind === 'checked' && input.checked === undefined)
    issues.push({ path: 'checked', code: 'REQUIRED', message: 'A source check needs its fields' });
  if (input.kind !== 'checked' && input.checked !== undefined)
    issues.push({ path: 'checked', code: 'NOT_ALLOWED', message: 'Only for kind checked' });
  if (input.kind === 'used' && input.used === undefined)
    issues.push({ path: 'used', code: 'REQUIRED', message: 'Used in practice needs its fields' });
  if (input.kind !== 'used' && input.used !== undefined)
    issues.push({ path: 'used', code: 'NOT_ALLOWED', message: 'Only for kind used' });
  if (input.used && input.used.worked !== 'yes' && !input.used.change?.trim())
    issues.push({
      path: 'used.change',
      code: 'REQUIRED',
      message: 'Say what had to change',
    });
  return issues;
}

/**
 * Derived state of an attestation (D-160): actor/reviewer events first, then the version binding,
 * then invalidation of its source ref. Reports without a decision are `open`.
 */
export function attestationState(
  a: { kind: AttestKind | 'report'; sectionHash: string },
  events: readonly { status: AttestationEventStatus }[],
  ctx: { currentHashes: ReadonlySet<string>; invalidated: boolean },
): AttestationState {
  const statuses = events.map((e) => e.status);
  if (statuses.includes('withdrawn')) return 'withdrawn';
  if (a.kind === 'report') {
    for (const s of ['fixed', 'dismissed', 'confirmed_error', 'confirmed'] as const)
      if (statuses.includes(s)) return s;
    return 'open';
  }
  if (!ctx.currentHashes.has(a.sectionHash)) return 'on_old_version';
  if (ctx.invalidated) return 'stale';
  if (statuses.includes('downweighted')) return 'downweighted';
  return 'active';
}
/** Whether an attestation still counts in team counts (and, once weighted, the score). */
export const counts = (state: AttestationState) => state === 'active' || state === 'downweighted';

/** 5 reports per person per page per 7 days (D-167). */
export function reportRateLimit(
  previous: readonly Date[],
  now: Date,
  limit: { count: number; days: number } = REPORT_LIMIT,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const windowStart = now.getTime() - limit.days * DAY_MS;
  const recent = previous
    .map((d) => d.getTime())
    .filter((t) => t > windowStart)
    .sort((x, y) => x - y);
  if (recent.length < limit.count) return { ok: true };
  const oldest = recent[recent.length - limit.count] ?? now.getTime();
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + limit.days * DAY_MS - now.getTime()) / 1000)),
  };
}

export interface CountRow {
  actorId: string;
  team: string | null;
  kind: AttestKind | 'report';
  state: AttestationState;
}
export interface CountAggregate {
  metric: string;
  team: string | null;
  count: number;
}
export interface PeopleCount {
  people: number;
  teams: { team: string; people: number }[];
}
const NO_TEAM = 'No team';
/** Team-only counts (D-168): distinct people per kind and team; purged aggregates added. */
export function teamCounts(
  rows: readonly CountRow[],
  aggregates: readonly CountAggregate[] = [],
): { checked: PeopleCount; used: PeopleCount; useful: number } {
  const of = (kind: 'checked' | 'used'): PeopleCount => {
    const byTeam = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.kind !== kind || !counts(r.state)) continue;
      const team = r.team ?? NO_TEAM;
      byTeam.set(team, (byTeam.get(team) ?? new Set()).add(r.actorId));
    }
    const sizes = new Map([...byTeam].map(([t, s]) => [t, s.size]));
    for (const a of aggregates)
      if (a.metric === kind) sizes.set(a.team ?? NO_TEAM, (sizes.get(a.team ?? NO_TEAM) ?? 0) + a.count);
    const teams = [...sizes]
      .map(([team, people]) => ({ team, people }))
      .sort((x, y) => y.people - x.people || x.team.localeCompare(y.team, 'en'));
    return { people: teams.reduce((n, t) => n + t.people, 0), teams };
  };
  const useful =
    new Set(rows.filter((r) => r.kind === 'useful' && counts(r.state)).map((r) => r.actorId)).size +
    aggregates.filter((a) => a.metric === 'useful').reduce((n, a) => n + a.count, 0);
  return { checked: of('checked'), used: of('used'), useful };
}

/** Reciprocal pairs (D-170): each attested a version the other authored. */
export function reciprocalPairs(
  attestations: readonly { id: string; actorId: string; authorIds: readonly string[] }[],
): { people: [string, string]; attestationIds: string[] }[] {
  const edges = new Map<string, string[]>();
  for (const a of attestations)
    for (const author of a.authorIds) {
      if (author === a.actorId) continue;
      const key = `${a.actorId}\0${author}`;
      edges.set(key, [...(edges.get(key) ?? []), a.id]);
    }
  const out: { people: [string, string]; attestationIds: string[] }[] = [];
  for (const [key, ids] of edges) {
    const [x = '', y = ''] = key.split('\0');
    if (x >= y) continue;
    const back = edges.get(`${y}\0${x}`);
    if (back) out.push({ people: [x, y], attestationIds: [...ids, ...back].sort() });
  }
  return out.sort((a, b) => (a.people.join() < b.people.join() ? -1 : 1));
}

export interface RetentionRow {
  id: string;
  createdAt: Date;
  final: boolean;
  counted: boolean;
  bucket: string;
}
/** Which raw rows the purge removes and how many each aggregate bucket gains (D-169). */
export function retentionPlan(
  rows: readonly RetentionRow[],
  cutoff: Date,
): { purge: string[]; add: Map<string, number> } {
  const purge: string[] = [];
  const add = new Map<string, number>();
  for (const r of rows) {
    if (r.createdAt >= cutoff || !r.final) continue;
    purge.push(r.id);
    if (r.counted) add.set(r.bucket, (add.get(r.bucket) ?? 0) + 1);
  }
  return { purge, add };
}
export const retentionCutoff = (now: Date, days = RETENTION_DAYS) =>
  new Date(now.getTime() - days * DAY_MS);

// ---- propagation and contradiction (D-178, D-179) ---------------------------------------------

/** Transitive descendants of the roots along derivation edges (BFS, cycle-safe). */
export function descendants(
  roots: readonly string[],
  edges: readonly { from: string; to: string }[],
): { key: string; depth: number }[] {
  const out: { key: string; depth: number }[] = [];
  const seen = new Set(roots);
  let frontier = [...roots];
  for (let depth = 1; frontier.length; depth++) {
    const next: string[] = [];
    for (const from of frontier)
      for (const e of edges)
        if (e.from === from && !seen.has(e.to)) {
          seen.add(e.to);
          out.push({ key: e.to, depth });
          next.push(e.to);
        }
    frontier = next;
  }
  return out;
}

/** A confirmed contradiction puts `self` under re-check unless `self` is the strong side. */
export function contradictionApplies(selfGroups: number, otherGroups: number): boolean {
  return !(selfGroups >= 2 && selfGroups > otherGroups);
}

// ---- label inputs from records (D-161) --------------------------------------------------------

interface Timed {
  id: string;
  sectionHash: string;
  time: string;
}
export interface SectionEvidence {
  currentHash: string;
  reviews: readonly (Timed & { kind: ReviewerKind })[];
  sourceChecks: readonly (Timed & {
    checkerKind: ReviewerKind;
    result: SourceCheckResult;
    sourceRef: string;
  })[];
  ownerConfirmations: readonly Timed[];
  errors: readonly (Timed & { reason: string })[];
  /** Flags still open (resolved ones are filtered by the caller). */
  flags: readonly (Timed & { reason: string })[];
  invalidations: readonly { id: string; kind: InvalidationKind; ref: string; time: string }[];
  /** Retractions a page author decided `still_correct` for this section hash. */
  clearedRetractions: ReadonlySet<string>;
  citedRefs: readonly string[];
  onHoldTopics: readonly { id: string; time: string }[];
  contradictions: readonly { id: string; time: string; applies: boolean }[];
  threshold?: LabelThreshold;
}

export function checkValid(
  check: { time: string; sourceRef: string },
  invalidations: SectionEvidence['invalidations'],
): boolean {
  const at = Date.parse(check.time);
  return !invalidations.some(
    (i) => INVALIDATING.has(i.kind) && i.ref === check.sourceRef && Date.parse(i.time) > at,
  );
}

/** Map raw records to `computeSectionLabel` inputs (system-logic §7.7.2 table). */
export function labelInputFromEvidence(e: SectionEvidence): SectionLabelInput {
  const hash = e.currentHash;
  const checks = e.sourceChecks.map((c) => ({ ...c, valid: checkValid(c, e.invalidations) }));
  const now = checks.filter((c) => c.sectionHash === hash && c.valid);
  const humanFail = now.filter((c) => c.result === 'not_supported' && c.checkerKind === 'person');
  const agentFail = now.filter((c) => c.result === 'not_supported' && c.checkerKind === 'agent');
  const retracted = e.invalidations.filter(
    (i) => i.kind === 'retraction' && e.citedRefs.includes(i.ref) && !e.clearedRetractions.has(i.id),
  );
  const unverifiable = now.filter((c) => c.result === 'unverifiable');
  const supported = now.filter((c) => c.result === 'supported');
  const latestUnverifiable = unverifiable.length > 0 && supported.length === 0;
  return {
    currentHash: hash,
    confirmedErrors: [
      ...e.errors.map((x) => ({ ...x, kind: 'person' as const })),
      ...humanFail.map((c) => ({
        id: c.id,
        sectionHash: c.sectionHash,
        time: c.time,
        kind: 'person' as const,
        reason: 'A person found the source does not support it',
      })),
    ],
    openRecheckReasons: [
      ...e.flags.map((f) => ({ ...f, kind: 'person' as const })),
      ...agentFail.map((c) => ({
        id: c.id,
        sectionHash: c.sectionHash,
        time: c.time,
        kind: 'agent' as const,
        reason: 'The reviewer agent found the source does not support it',
      })),
      ...retracted.map((i) => ({
        id: i.id,
        sectionHash: hash,
        time: i.time,
        kind: 'agent' as const,
        reason: 'A cited source was retracted',
      })),
      ...e.onHoldTopics.map((t) => ({
        id: t.id,
        sectionHash: hash,
        time: t.time,
        kind: 'person' as const,
        reason: 'A discussion on this section is on hold',
      })),
      ...e.contradictions
        .filter((c) => c.applies)
        .map((c) => ({
          id: c.id,
          sectionHash: hash,
          time: c.time,
          kind: 'person' as const,
          reason: 'Another page contradicts this section',
        })),
    ],
    reviewedVersions: e.reviews.map((r) =>
      latestUnverifiable && r.sectionHash === hash ? { ...r, reason: 'source not checkable' } : r,
    ),
    sourceChecks: checks.map((c) => ({
      id: c.id,
      sectionHash: c.sectionHash,
      time: c.time,
      checkerKind: c.checkerKind,
      result: c.result,
      valid: c.valid,
    })),
    ownerConfirmations: e.ownerConfirmations.map((o) => ({ ...o, kind: 'person', valid: true })),
    ...(e.threshold && { threshold: e.threshold }),
  };
}

/** Distinct provenance roots of a section (refs with a valid supported check on its hash). */
export function provenanceGroups(
  checks: SectionEvidence['sourceChecks'],
  currentHash: string,
  invalidations: SectionEvidence['invalidations'],
): number {
  return new Set(
    checks
      .filter(
        (c) =>
          c.sectionHash === currentHash && c.result === 'supported' && checkValid(c, invalidations),
      )
      .map((c) => c.sourceRef),
  ).size;
}

// ---- Workspace queue (D-174) ------------------------------------------------------------------

export const QUEUE_TYPES = ['report', 'retraction', 'flag', 'candidate', 'pair', 'fix'] as const;
export type QueueType = (typeof QUEUE_TYPES)[number];
export const QUEUE_OUTCOMES: Record<QueueType, readonly string[]> = {
  report: ['confirm', 'confirm_error', 'dismiss'],
  retraction: ['still_correct', 'confirm_error', 'keep_recheck'],
  flag: ['still_correct', 'confirm_error', 'keep_recheck'],
  candidate: ['yes', 'no', 'ask_authors'],
  pair: [],
  fix: [],
};
/** Reach first (links, then teams), then blocking, then oldest. */
export function queueOrder<
  T extends { reach: { linkedFrom: number; teams: number }; blocking: boolean; at: string; id: string },
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      b.reach.linkedFrom - a.reach.linkedFrom ||
      b.reach.teams - a.reach.teams ||
      Number(b.blocking) - Number(a.blocking) ||
      Date.parse(a.at) - Date.parse(b.at) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

// ---- gates (D-177) ----------------------------------------------------------------------------

export const GATE_CAPABILITIES = [
  'label_threshold',
  'recheck_ordering',
  'attestation_weights',
  'report_detection',
  'assistant_disclosure',
] as const;
export type GateCapability = (typeof GATE_CAPABILITIES)[number];
export const GATE_EXPERIMENT: Record<GateCapability, 'E8b' | 'E8c' | 'E8d'> = {
  label_threshold: 'E8d',
  recheck_ordering: 'E8d',
  attestation_weights: 'E8b',
  report_detection: 'E8b',
  assistant_disclosure: 'E8c',
};
export const GATE_DESCRIPTION: Record<GateCapability, string> = {
  label_threshold: 'Use θ and hysteresis in label rule 4',
  recheck_ordering: 'Order the re-check queue by lower bound × blast radius',
  attestation_weights: 'Give Checked and Used in practice attestations a weight',
  report_detection: 'Count reports as a detection layer in health metrics',
  assistant_disclosure: 'Assistant disclosure endpoint',
};
/** Enabling needs a run record and a past date; disabling needs nothing. */
export function validateGateChange(
  input: { enabled: boolean; runRecord?: string | undefined; runDate?: string | undefined },
  today: Date,
): FieldIssue[] {
  if (!input.enabled) return [];
  const issues: FieldIssue[] = [];
  const record = input.runRecord?.trim() ?? '';
  if (!record)
    issues.push({ path: 'runRecord', code: 'REQUIRED', message: 'Enter the experiment run record' });
  else if (record.length > 300 || record.includes('\0') || record.split('/').includes('..'))
    issues.push({ path: 'runRecord', code: 'INVALID', message: 'Not a run record path' });
  if (!input.runDate)
    issues.push({ path: 'runDate', code: 'REQUIRED', message: 'Enter the experiment result date' });
  else if (!isCalendarDate(input.runDate) || input.runDate > today.toISOString().slice(0, 10))
    issues.push({ path: 'runDate', code: 'INVALID', message: 'Not a past calendar date' });
  return issues;
}

// ---- notifications and digests (D-172) --------------------------------------------------------

export const NOTIFICATION_EVENTS = [
  'section_recheck',
  'section_edited',
  'report_outcome',
  'report_received',
  'mention',
  'weekly_summary',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const PREF_EVENTS = [
  'section_recheck',
  'section_edited',
  'report_outcome',
  'weekly_summary',
] as const;
export type PrefEvent = (typeof PREF_EVENTS)[number];
export type StoredChannel = 'in_app' | 'email_daily' | 'off';
export type PrefChannel = 'wiki' | 'wiki_and_daily_email';
export interface NotificationPrefs {
  events: Record<PrefEvent, boolean>;
  channel: PrefChannel;
}
/** Absent rows mean the defaults: every event on, wiki only. */
export function prefsFromRows(rows: readonly { event: string; channel: StoredChannel }[]): NotificationPrefs {
  const by = new Map(rows.map((r) => [r.event, r.channel]));
  const events = Object.fromEntries(PREF_EVENTS.map((e) => [e, by.get(e) !== 'off'])) as Record<
    PrefEvent,
    boolean
  >;
  const email = rows.some((r) => r.channel === 'email_daily');
  return { events, channel: email ? 'wiki_and_daily_email' : 'wiki' };
}
export function rowsFromPrefs(prefs: NotificationPrefs): { event: PrefEvent; channel: StoredChannel }[] {
  const on: StoredChannel = prefs.channel === 'wiki_and_daily_email' ? 'email_daily' : 'in_app';
  return PREF_EVENTS.map((event) => ({ event, channel: prefs.events[event] ? on : 'off' }));
}
/** Where one event goes for one person: nothing, the bell, or the bell plus email. */
export function deliveryFor(
  event: NotificationEvent,
  prefs: NotificationPrefs,
): { inApp: boolean; email: boolean } {
  const email = prefs.channel === 'wiki_and_daily_email';
  // Duty and outcome notices ignore the toggles but respect the channel (§7.7.9).
  if (event === 'report_received' || event === 'mention' || event === 'report_outcome')
    return { inApp: true, email };
  if (event === 'weekly_summary') return { inApp: false, email: email && prefs.events.weekly_summary };
  return prefs.events[event] ? { inApp: true, email } : { inApp: false, email: false };
}

export interface DigestItem {
  event: NotificationEvent;
  path: string | null;
  pageTitle: string | null;
  text: string;
  createdAt: string;
}
/** One email body grouping notifications by page, oldest first inside a page. */
export function buildDigest(
  user: { name: string },
  items: readonly DigestItem[],
  period: 'daily' | 'weekly',
  wikiName = 'Wiki',
): { subject: string; text: string } | null {
  if (!items.length) return null;
  const groups = new Map<string, DigestItem[]>();
  for (const item of items) {
    const key = item.pageTitle ?? item.path ?? 'General';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const lines = [`Hello ${user.name},`, '', `Here is your ${period} summary from ${wikiName}.`, ''];
  for (const [title, list] of [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    lines.push(`${title}${list[0]?.path ? ` (${list[0].path})` : ''}`);
    for (const item of [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
      lines.push(`- ${item.text}`);
    lines.push('');
  }
  lines.push('You get this email because of your notification settings in the wiki.');
  const n = items.length;
  return {
    subject: `${wikiName}: ${String(n)} update${n === 1 ? '' : 's'} on pages you follow`,
    text: lines.join('\n'),
  };
}

/** Reader-facing words for each label when the label is the subject of `Why this label`. */
export const LABEL_MEANING: Record<Label, string> = {
  checked: 'A person compared this version with its source and it matched.',
  reviewed:
    'A reviewer approved this version; nobody has checked it against its source yet.',
  not_reviewed: 'This version was written before review started, or was never approved.',
  recheck: 'This section is being checked again. Use with care.',
  error: 'This section is known to be wrong. Do not rely on it until it is fixed.',
};
export const LABEL_CHANGE: Record<Label, string[]> = {
  checked: [
    'An edit to this section starts a new version without this evidence.',
    'A retraction or change of the source makes the check stop counting.',
  ],
  reviewed: ['A person checks it against its source, or a page author confirms it.'],
  not_reviewed: ['A reviewer approves a change that contains it.'],
  recheck: ['A page author resolves the re-check, or a correction is published.'],
  error: ['A correction is published.'],
};
