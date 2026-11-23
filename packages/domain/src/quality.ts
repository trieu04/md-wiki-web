import { sha256Hex } from './bundle.js';
import { err, ok, type Result } from './result.js';

/**
 * Quality check rules (system-logic §7.6). Pure: the rules file parser (a port of the worker's
 * `quality/rules.py`, §7.3), quote normalisation and location, finding re-verification, run
 * freshness and flags, and the draft digest.
 */

export const QUALITY_RULES_LIMIT = 64 * 1024;
/** An active run older than this counts as lost and may be superseded (§7.6.4). */
export const QUALITY_LEASE_MS = 15 * 60_000;
export const SEVERITIES = ['info', 'warning', 'blocking'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const QUALITY_FLAGS = ['blocking_finding', 'dropped_hedge', 'check_failed'] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface QualityRule {
  id: string;
  title: string;
  body: string;
}
export interface QualityRules {
  sha256: string;
  /** The text before the first rule (sent to the model, not a rule). */
  preamble: string;
  rules: QualityRule[];
}

const HEADING = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const EXPLICIT_ID = /\s*\{#([a-z0-9][a-z0-9-]*)\}$/;
const FENCE = /^\s*(```|~~~)/;

export function ruleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parse the rules file from its exact bytes; the hash covers those bytes (§7.3, D-73). */
export function parseQualityRules(raw: Uint8Array): Result<QualityRules, string> {
  if (raw.length > QUALITY_RULES_LIMIT) return err('rules file is larger than 64 KiB');
  const digest = sha256Hex(raw);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    return err('rules file is not valid UTF-8');
  }
  text = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const rules: QualityRule[] = [];
  const preamble: string[] = [];
  let current: { id: string; title: string } | null = null;
  let body: string[] = [];
  let inFence = false;
  const close = () => {
    if (current) rules.push({ ...current, body: body.join('\n').trim() });
  };
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const match = inFence ? null : HEADING.exec(line);
    if (match?.[1] !== undefined) {
      close();
      let title = match[1];
      const explicit = EXPLICIT_ID.exec(title);
      let id: string;
      if (explicit?.[1] !== undefined) {
        id = explicit[1];
        title = title.slice(0, explicit.index).trim();
      } else {
        id = ruleSlug(title);
      }
      if (!id) return err(`rule heading ${JSON.stringify(title)} has no usable id`);
      if (rules.some((r) => r.id === id)) return err(`duplicate rule id ${JSON.stringify(id)}`);
      current = { id, title };
      body = [];
    } else if (current) {
      body.push(line);
    } else {
      preamble.push(line);
    }
  }
  close();
  if (rules.length === 0) return err("rules file has no '## ' rule headings");
  return ok({ sha256: digest, preamble: preamble.join('\n').trim(), rules });
}

// Unicode whitespace as Python's str.isspace() plus zero-width characters and BOM, so the API's
// re-verification agrees with the worker's (quality/findings.py).
// eslint-disable-next-line no-control-regex -- Python's isspace() counts \x1c-\x1f
const SPACE = /[\s\u001c-\u001f\u0085\u200b-\u200d\u2060\ufeff]+/gu;
// eslint-disable-next-line no-control-regex -- as above
const IS_SPACE = /^[\s\u001c-\u001f\u0085\u200b-\u200d\u2060\ufeff]$/u;

/** NFC, every whitespace run → one space, trimmed (D-73). */
export function normalizeQuote(text: string): string {
  return text.normalize('NFC').replace(SPACE, ' ').trim();
}

/** 1-based lines of the first occurrence of the normalised quote in the text, or null. */
export function locateQuote(
  quote: string,
  text: string,
): { lineStart: number; lineEnd: number } | null {
  const needle = normalizeQuote(quote);
  if (!needle) return null;
  // NFC never moves a line break, so lines of the NFC text are lines of the text.
  const nfc = text.normalize('NFC');
  const chars = Array.from(nfc);
  let collapsed = '';
  const origin: number[] = []; // index in `chars` for each UTF-16 unit of `collapsed`
  let pending: number | null = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? '';
    if (IS_SPACE.test(ch)) {
      pending ??= i;
      continue;
    }
    if (pending !== null && collapsed.length > 0) {
      collapsed += ' ';
      origin.push(pending);
    }
    pending = null;
    for (let k = 0; k < ch.length; k++) origin.push(i);
    collapsed += ch;
  }
  const at = collapsed.indexOf(needle);
  if (at < 0) return null;
  const lineOf = (charIndex: number) => {
    let line = 1;
    for (let i = 0; i < charIndex; i++) if (chars[i] === '\n') line++;
    return line;
  };
  return {
    lineStart: lineOf(origin[at] ?? 0),
    lineEnd: lineOf(origin[at + needle.length - 1] ?? 0),
  };
}

export type DropReason = 'unknownRule' | 'unknownBlock' | 'emptyQuote' | 'quoteNotFound';
export type DroppedCounts = Record<DropReason, number>;
export const noDrops = (): DroppedCounts => ({
  unknownRule: 0,
  unknownBlock: 0,
  emptyQuote: 0,
  quoteNotFound: 0,
});

export interface CandidateFinding {
  rule: string;
  quote: { block: string; text: string };
  original?: { block: string; text: string } | null;
}

/** Why a finding must be dropped, or null when it stands (§7.6.3, D-134). */
export function checkFinding(
  finding: CandidateFinding,
  blocks: ReadonlyMap<string, string>,
  ruleIds: ReadonlySet<string>,
): DropReason | null {
  if (!ruleIds.has(finding.rule)) return 'unknownRule';
  const content = blocks.get(finding.quote.block);
  if (content === undefined) return 'unknownBlock';
  if (finding.original && !blocks.has(finding.original.block)) return 'unknownBlock';
  const quote = normalizeQuote(finding.quote.text);
  if (!quote) return 'emptyQuote';
  if (!normalizeQuote(content).includes(quote)) return 'quoteNotFound';
  if (finding.original) {
    const original = normalizeQuote(finding.original.text);
    if (!original) return 'emptyQuote';
    if (!normalizeQuote(blocks.get(finding.original.block) ?? '').includes(original))
      return 'quoteNotFound';
  }
  return null;
}

/** Keep verified findings in order (identical ones once); count the rest by reason. */
export function verifyFindings<F extends CandidateFinding>(
  findings: readonly F[],
  blocks: ReadonlyMap<string, string>,
  ruleIds: ReadonlySet<string>,
): { kept: F[]; dropped: DroppedCounts } {
  const kept: F[] = [];
  const dropped = noDrops();
  const seen = new Set<string>();
  for (const finding of findings) {
    const reason = checkFinding(finding, blocks, ruleIds);
    if (reason) {
      dropped[reason]++;
      continue;
    }
    const key = [finding.rule, finding.quote.block, normalizeQuote(finding.quote.text)].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(finding);
  }
  return { kept, dropped };
}

export function addDrops(a: DroppedCounts, b: Partial<DroppedCounts>): DroppedCounts {
  return {
    unknownRule: a.unknownRule + (b.unknownRule ?? 0),
    unknownBlock: a.unknownBlock + (b.unknownBlock ?? 0),
    emptyQuote: a.emptyQuote + (b.emptyQuote ?? 0),
    quoteNotFound: a.quoteNotFound + (b.quoteNotFound ?? 0),
  };
}

export interface RunFacts {
  status: RunStatus;
  bundleHash: string | null;
  createdAt: Date;
  counts: Record<Severity, number>;
  /** Findings of the deterministic rule (origin `rule`). */
  ruleFindings: number;
}
export type QualityStatus = RunStatus | 'none';
export interface QualitySummary {
  status: QualityStatus;
  findings: number;
  counts: Record<Severity, number>;
  flags: QualityFlag[];
  current: boolean;
}

/** Queued or running, and younger than the lease (§7.6.4). */
export function isActiveRun(run: Pick<RunFacts, 'status' | 'createdAt'>, now: Date): boolean {
  return (
    (run.status === 'queued' || run.status === 'running') &&
    now.getTime() - run.createdAt.getTime() < QUALITY_LEASE_MS
  );
}

/** The latest succeeded run bound to the subject's current hash (runs newest first). */
export function currentRun<R extends Pick<RunFacts, 'status' | 'bundleHash'>>(
  runs: readonly R[],
  hash: string,
): R | null {
  return runs.find((r) => r.status === 'succeeded' && r.bundleHash === hash) ?? null;
}

export function qualityFlags(current: RunFacts | null, latest: RunFacts | null): QualityFlag[] {
  const flags: QualityFlag[] = [];
  if (current && current.counts.blocking > 0) flags.push('blocking_finding');
  if (current && current.ruleFindings > 0) flags.push('dropped_hedge');
  if (latest?.status === 'failed') flags.push('check_failed');
  return flags;
}

/** The summary of a subject's runs (newest first) against its current hash (§7.6.4). */
export function qualitySummary(runs: readonly RunFacts[], hash: string): QualitySummary {
  const latest = runs[0] ?? null;
  const current = currentRun(runs, hash);
  const counts = current ? { ...current.counts } : { info: 0, warning: 0, blocking: 0 };
  return {
    status: latest?.status ?? 'none',
    findings: counts.info + counts.warning + counts.blocking,
    counts,
    flags: qualityFlags(current, latest),
    current: current !== null,
  };
}

export interface DraftDigestInput {
  targetPath: string;
  baseSha256: string | null;
  section: string | null;
  proposedSha256: string;
  title: string;
  reason: string;
  sources: readonly { path: string; sha256: string }[];
}

/** What a draft self-check is bound to (§7.6.6): SHA-256 of the canonical JSON. */
export function draftDigest(input: DraftDigestInput): string {
  const canonical = JSON.stringify({
    targetPath: input.targetPath,
    baseSha256: input.baseSha256,
    section: input.section,
    proposedSha256: input.proposedSha256,
    title: input.title,
    reason: input.reason,
    sources: input.sources.map((s) => ({ path: s.path, sha256: s.sha256 })),
  });
  return sha256Hex(new TextEncoder().encode(canonical));
}
