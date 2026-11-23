import type { components } from '@md-wiki/contracts';
import { parseStatusBlock } from '@md-wiki/domain';

type S = components['schemas'];
export type QualityReportDto = S['QualityReportDto'];
export type QualityRunDto = S['QualityRunDto'];
export type QualitySummaryDto = S['QualitySummaryDto'];
export type FindingDto = S['FindingDto'];
export type DroppedDto = S['DroppedDto'];
export type FindingSeverity = S['FindingSeverity'];
export type QualityFlag = S['QualityFlag'];

/** D-138/D-145: the API's `info | warning | blocking` read as the frames' low / medium / high. */
export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  info: 'low',
  warning: 'medium',
  blocking: 'high',
};

/** D-145: advisory flags (system-logic §7.6.4) in words. */
export const FLAG_LABEL: Record<QualityFlag, string> = {
  blocking_finding: 'High-severity finding',
  dropped_hedge: 'A hedge from the source was dropped',
  check_failed: 'The last check failed',
};

/** D-146: worker/API failure codes (§7.6.3, D-143) are not API `ErrorCode`s; one sentence each. */
const JOB_ERROR_TEXT: Record<string, string> = {
  provider_error: 'the model provider returned an error',
  provider_timeout: 'the model provider timed out',
  rate_limited: 'the model provider is rate limiting requests',
  schema_invalid: 'the model’s answer was not in the expected form',
  input_invalid: 'the check input was not valid',
  rules_invalid: 'the quality rules file is missing or not valid',
  worker_error: 'the worker hit an internal error',
  superseded: 'a newer check replaced it',
};

export function jobErrorText(error: { code: string; message: string } | null | undefined) {
  if (!error) return 'it stopped without a result';
  return JOB_ERROR_TEXT[error.code] ?? `it stopped (${error.code})`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * Lines the preview artifact adds above the proposed file (its status block, D-33): finding lines
 * are lines of the proposed file, the Changes tab numbers artifact lines.
 */
export function artifactLineOffset(artifact: string | null | undefined): number {
  if (!artifact) return 0;
  const { block, body } = parseStatusBlock(artifact);
  if (!block) return 0;
  const head = artifact.slice(0, artifact.length - body.length);
  return head.split('\n').length - 1;
}

const lineSpan = (start: number, end: number | null) =>
  end !== null && end > start ? `Lines ${String(start)}–${String(end)}` : `Line ${String(start)}`;

/** Where a finding's quote is: a line of the proposal, or the data block it came from (D-147). */
export function findingPlace(
  finding: Pick<FindingDto, 'block' | 'lineStart' | 'lineEnd'>,
  offset = 0,
) {
  const { block, lineStart, lineEnd } = finding;
  const at = (prefix: string) =>
    lineStart === null ? prefix : `${prefix}, ${lineSpan(lineStart, lineEnd).toLowerCase()}`;
  if (block === 'proposed')
    return lineStart === null
      ? { text: 'Proposal', line: null }
      : {
          text: lineSpan(lineStart + offset, lineEnd === null ? null : lineEnd + offset),
          line: lineStart + offset,
        };
  if (block === 'title') return { text: 'Title', line: null };
  if (block === 'reason') return { text: 'Reason', line: null };
  if (block === 'base') return { text: at('Current page'), line: null };
  const source = /^source-(\d+)$/u.exec(block);
  if (source) return { text: at(`Source ${source[1] ?? ''}`), line: null };
  return { text: at(block), line: null };
}

export type FindingRow = {
  key: string;
  place: string;
  /** Line in the Changes tab (`#line-N`), only for quotes from the proposal. */
  line: number | null;
  severity: string;
  message: string;
  quote: string;
  rule: string;
  /** dropped-hedge: the hedged sentence of the base/source the proposal derived from. */
  original: string | null;
};

export function findingRows(findings: readonly FindingDto[], offset = 0): FindingRow[] {
  return findings.map((finding) => {
    const place = findingPlace(finding, offset);
    return {
      key: finding.id,
      place: place.text,
      line: place.line,
      severity: SEVERITY_LABEL[finding.severity],
      message: finding.message,
      quote: finding.quote,
      rule: finding.ruleTitle ?? finding.rule,
      original: finding.original?.text ?? null,
    };
  });
}

/** The frame's "1 finding dropped: its quote was not in the proposal" (D-147). */
export function droppedText(dropped: DroppedDto | null | undefined, subject = 'the proposal') {
  if (!dropped?.total) return null;
  const head = `${plural(dropped.total, 'finding')} dropped`;
  if (dropped.quoteNotFound === dropped.total)
    return `${head}: ${dropped.total === 1 ? 'its quote was' : 'their quotes were'} not in ${subject}`;
  return `${head}: could not be checked against ${subject}`;
}

/** Meta line under the findings: dropped · model · rules file version. */
export function runMeta(run: QualityRunDto, subject = 'the proposal') {
  return [
    droppedText(run.dropped, subject),
    run.model,
    run.rulesSha256 &&
      `quality.md ${run.rulesSha256.slice(0, 6)}${run.rulesChanged ? ' (rules changed since)' : ''}`,
  ]
    .filter((part): part is string => !!part)
    .join(' · ');
}

const isActive = (run: QualityRunDto | null) =>
  run?.status === 'queued' || run?.status === 'running';

export type QualityCard = {
  /** What the card body shows (D-148). */
  state: 'none' | 'active' | 'failed' | 'stale' | 'clean' | 'findings';
  /** One sentence for the non-findings states, and the notice above findings. */
  note: string | null;
  rows: FindingRow[];
  meta: string;
  flags: string[];
  active: boolean;
};

/**
 * Quality card / Self-check body (system-logic §7.6.4): findings come only from the **current** run;
 * a newer active or failed run is a notice above them, a stale run is never shown as current.
 */
export function qualityCard(
  report: QualityReportDto,
  { subject, offset = 0 }: { subject: 'proposal' | 'draft'; offset?: number },
): QualityCard {
  const { current, latest, summary } = report;
  const what = subject === 'draft' ? 'your draft' : 'the proposal';
  const active = isActive(latest);
  const flags = summary.flags.map((flag) => FLAG_LABEL[flag]);
  const failed =
    latest?.status === 'failed'
      ? `The last check failed: ${jobErrorText(latest.error)}.${subject === 'proposal' ? ' Review works without it.' : ''}`
      : null;
  const running =
    latest?.status === 'queued'
      ? 'Quality check queued.'
      : latest?.status === 'running'
        ? 'Quality check running…'
        : null;
  if (current) {
    const rows = findingRows(current.findings, offset);
    const notice = running
      ? running.replace('Quality check', 'A new check is')
      : latest && latest.id !== current.id && latest.status === 'failed'
        ? failed
        : null;
    return {
      state: rows.length ? 'findings' : 'clean',
      note: rows.length ? notice : [notice, 'No findings.'].filter(Boolean).join(' '),
      rows,
      meta: runMeta(current, what),
      flags,
      active,
    };
  }
  const base = { rows: [], flags, active, meta: '' };
  if (running) return { ...base, state: 'active', note: running };
  if (failed) return { ...base, state: 'failed', note: failed };
  if (latest)
    return {
      ...base,
      state: 'stale',
      note:
        subject === 'draft'
          ? 'You changed the draft since the last check. Run it again to check this version.'
          : 'The last check ran on another version. Its findings are not shown.',
    };
  return {
    ...base,
    state: 'none',
    note:
      subject === 'draft'
        ? 'Check your draft against the quality rules before you submit.'
        : 'No quality check has run on this proposal.',
  };
}

/** F-09 *Quality* column (D-149): the frame's "1 finding" / "No findings" / "Running" / "—". */
export function qualityCell(summary: QualitySummaryDto) {
  if (summary.status === 'queued' || summary.status === 'running') return 'Running';
  if (summary.status === 'failed') return 'Check failed';
  if (!summary.current) return '—';
  return summary.findings ? plural(summary.findings, 'finding') : 'No findings';
}

/** "1 min 40 s" / "52 s" (F-13 Background jobs). */
export function durationText(ms: number | null | undefined) {
  if (ms === null || ms === undefined || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60)
    return rest ? `${String(minutes)} min ${String(rest)} s` : `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${String(hours)} h ${String(mins)} min` : `${String(hours)} h`;
}

/** Splits `text` around each occurrence of the quotes, for the wavy underline in Changes. */
export function markQuotes(text: string, quotes: readonly string[]) {
  const ranges: [number, number][] = [];
  for (const quote of quotes) {
    if (!quote) continue;
    let from = text.indexOf(quote);
    while (from !== -1) {
      ranges.push([from, from + quote.length]);
      from = text.indexOf(quote, from + quote.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (end <= at) continue;
    const begin = Math.max(start, at);
    if (begin > at) parts.push({ text: text.slice(at, begin), mark: false });
    parts.push({ text: text.slice(begin, end), mark: true });
    at = end;
  }
  if (at < text.length || !parts.length) parts.push({ text: text.slice(at), mark: false });
  return parts;
}

/**
 * Quotes to underline on one Changes row: findings quoting the proposal on that artifact line. A
 * quote across lines is underlined on each line it covers, per line.
 */
export function quotesOnLine(findings: readonly FindingDto[], line: number, offset: number) {
  return findings.flatMap((finding) => {
    if (finding.block !== 'proposed' || finding.lineStart === null) return [];
    const start = finding.lineStart + offset;
    const end = (finding.lineEnd ?? finding.lineStart) + offset;
    if (line < start || line > end) return [];
    if (start === end) return [finding.quote];
    const parts = finding.quote.split('\n');
    return parts[line - start] ? [parts[line - start] ?? ''] : [];
  });
}

/** F-10 Changes rows with the current run's quotes underlined on their lines. */
export function markDiffRows<R extends { kind: string; number: number | null; text: string }>(
  rows: readonly R[],
  findings: readonly FindingDto[],
  offset: number,
): (R & { parts?: { text: string; mark: boolean }[] })[] {
  if (!findings.length) return [...rows];
  return rows.map((row) => {
    if (row.kind === 'del' || row.kind === 'gap' || row.number === null) return row;
    const quotes = quotesOnLine(findings, row.number, offset);
    if (!quotes.length) return row;
    const parts = markQuotes(row.text, quotes);
    return parts.some(({ mark }) => mark) ? { ...row, parts } : row;
  });
}
