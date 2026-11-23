import { parseQualityRules, type RunFacts, type Severity } from '@md-wiki/domain';
import type { AiJob, Finding, User } from '@prisma/client';
import type { Wire } from '../wiki/read.dto.js';
import type { FindingDto, JobListItemDto, QualityRunDto } from './quality.dto.js';

/** Row → DTO mapping for quality runs (system-logic §7.6.7). Pure. */

export type RunRow = AiJob & {
  findings?: Finding[];
  requestedBy?: Pick<User, 'id' | 'name' | 'kind'> | null;
  _count?: { findings: number };
};
type Counts = Record<Severity, number>;
const userRef = (u: Pick<User, 'id' | 'name' | 'kind'>) => ({
  id: u.id,
  name: u.name,
  kind: u.kind,
});
export const ACTIVE = ['queued', 'running'] as const;

export function severityCounts(findings: readonly Pick<Finding, 'severity'>[]): Counts {
  const counts: Counts = { info: 0, warning: 0, blocking: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/** The facts the domain summary needs (findings must be loaded for succeeded runs). */
export function runFacts(row: RunRow): RunFacts {
  const findings = row.findings ?? [];
  return {
    status: row.status,
    bundleHash: row.bundleHash,
    createdAt: row.createdAt,
    counts: severityCounts(findings),
    ruleFindings: findings.filter((f) => f.origin === 'rule').length,
  };
}

const jobError = (error: AiJob['error']) => {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e && typeof e.code === 'string' && typeof e.message === 'string'
    ? { code: e.code, message: e.message }
    : null;
};

/** Rule titles of the rules text a run was created with. */
export function ruleTitles(input: AiJob['input']): Map<string, string> {
  const text = (input as { rules?: { text?: unknown } } | null)?.rules?.text;
  if (typeof text !== 'string') return new Map();
  const parsed = parseQualityRules(Buffer.from(text, 'utf8'));
  return new Map<string, string>(parsed.ok ? parsed.value.rules.map((r) => [r.id, r.title]) : []);
}

export function findingDto(f: Finding, titles: Map<string, string>): Wire<FindingDto> {
  const original = f.original as { block: string; text: string } | null;
  return {
    id: f.id,
    rule: f.rule,
    ruleTitle: titles.get(f.rule) ?? null,
    severity: f.severity,
    message: f.message,
    block: f.block,
    quote: f.quote,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    origin: f.origin,
    original: original ? { block: original.block, text: original.text } : null,
  };
}

export function runDto(
  row: RunRow,
  ctx: { hash: string; rulesSha256: string | null; withFindings: boolean },
): Wire<QualityRunDto> {
  const findings = row.findings ?? [];
  const dropped = row.dropped as Record<string, number> | null;
  const titles = ctx.withFindings ? ruleTitles(row.input) : new Map<string, string>();
  return {
    id: row.id,
    trigger:
      row.trigger === 'dev'
        ? 'rerun'
        : (row.trigger as Exclude<typeof row.trigger, 'dev' | 'after_check' | 'returned' | 'resumed'>),
    status: row.status,
    bundleHash: row.bundleHash ?? '',
    current: row.bundleHash === ctx.hash,
    rulesSha256: row.rulesSha256,
    rulesChanged: row.rulesSha256 !== null && row.rulesSha256 !== ctx.rulesSha256,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    error: jobError(row.error),
    dropped: dropped
      ? {
          unknownRule: dropped.unknownRule ?? 0,
          unknownBlock: dropped.unknownBlock ?? 0,
          emptyQuote: dropped.emptyQuote ?? 0,
          quoteNotFound: dropped.quoteNotFound ?? 0,
          total:
            (dropped.unknownRule ?? 0) +
            (dropped.unknownBlock ?? 0) +
            (dropped.emptyQuote ?? 0) +
            (dropped.quoteNotFound ?? 0),
        }
      : null,
    counts: severityCounts(findings),
    findings: ctx.withFindings ? findings.map((f) => findingDto(f, titles)) : [],
    requestedBy: row.requestedBy ? userRef(row.requestedBy) : null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function jobListItem(
  row: AiJob & { proposal: { slug: string; title: string } | null; _count: { findings: number } },
): Wire<JobListItemDto> {
  return {
    id: row.id,
    kind: row.kind,
    trigger: row.trigger,
    status: row.status,
    subject: row.proposal
      ? { kind: 'proposal', slug: row.proposal.slug, title: row.proposal.title }
      : row.draftId
        ? { kind: 'draft', slug: null, title: null }
        : null,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    findings:
      row.kind === 'quality_check' && row.status === 'succeeded' ? row._count.findings : null,
    error: jobError(row.error),
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs:
      row.finishedAt && row.startedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
  };
}
