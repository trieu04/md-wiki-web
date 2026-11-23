import type { components } from '@md-wiki/contracts';
import { artifactLineOffset } from '../../features/quality/model';

type S = components['schemas'];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hex = (c: string) => c.repeat(64).slice(0, 64);
const rulesSha = hex('3f2a91');
const noCounts = { info: 0, warning: 0, blocking: 0 };

export const emptySummary: S['QualitySummaryDto'] = {
  status: 'none',
  findings: 0,
  counts: noCounts,
  flags: [],
  current: false,
};

/** F-09 *Quality* cells as drawn ("1 finding", "No findings", "Running", "3 findings", "—"). */
export function visualQualitySummary(cell: string): S['QualitySummaryDto'] {
  if (cell === 'Running') return { ...emptySummary, status: 'running' };
  if (cell === '—') return emptySummary;
  const findings = Number.parseInt(cell, 10) || 0;
  return {
    status: 'succeeded',
    findings,
    counts: { ...noCounts, warning: findings },
    flags: [],
    current: true,
  };
}

function run(overrides: Partial<S['QualityRunDto']>): S['QualityRunDto'] {
  return {
    id: uuid(1100),
    trigger: 'submit',
    status: 'succeeded',
    bundleHash: hex('a1f3c9e2'),
    current: true,
    rulesSha256: rulesSha,
    rulesChanged: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    promptVersion: 'quality-v1',
    tokensIn: 1840,
    tokensOut: 212,
    error: null,
    dropped: { unknownRule: 0, unknownBlock: 0, emptyQuote: 0, quoteNotFound: 1, total: 1 },
    counts: { ...noCounts, warning: 1 },
    findings: [],
    requestedBy: null,
    createdAt: '2026-11-23T10:05:00.000Z',
    startedAt: '2026-11-23T10:05:20.000Z',
    finishedAt: '2026-11-23T10:07:00.000Z',
    ...overrides,
  };
}

function report(
  subject: S['QualitySubjectDto'],
  current: S['QualityRunDto'] | null,
  latest: S['QualityRunDto'] | null,
  rerun: boolean,
): S['QualityReportDto'] {
  const findings = current?.findings ?? [];
  return {
    subject,
    bundleHash: current?.bundleHash ?? hex('a1f3c9e2'),
    summary: {
      status: latest?.status ?? 'none',
      findings: findings.length,
      counts: current?.counts ?? noCounts,
      flags: [
        ...(findings.some(({ severity }) => severity === 'blocking')
          ? (['blocking_finding'] as const)
          : []),
        ...(findings.some(({ origin }) => origin === 'rule') ? (['dropped_hedge'] as const) : []),
        ...(latest?.status === 'failed' ? (['check_failed'] as const) : []),
      ],
      current: current !== null,
    },
    current,
    latest,
    runs: latest ? [latest] : [],
    can: { rerun },
  };
}

/**
 * F-10 *Quality check* sample: line 14 · medium · reason vs. added claim, one dropped finding,
 * claude-sonnet-5-5, rules 3f2a91. Lines are of the proposed file: the artifact's status block
 * sits above them (D-33), so line 14 of the Changes tab is `14 - offset` here.
 */
export function visualProposalQuality(artifact: string, scenario: string | null) {
  const offset = artifactLineOffset(artifact);
  const finding: S['FindingDto'] = {
    id: uuid(1200),
    rule: 'understated-reason',
    ruleTitle: 'Reason understates the change',
    severity: 'warning',
    message: 'The reason says “fix units” but the line also adds a claim.',
    block: 'proposed',
    quote: 'gives little extra sectioning',
    lineStart: 14 - offset,
    lineEnd: 14 - offset,
    origin: 'model',
    original: null,
  };
  const subject = { kind: 'proposal' as const, id: uuid(500), slug: 'fix-pinhole-units' };
  if (scenario === 'quality-running') {
    const active = run({ status: 'running', findings: [], finishedAt: null, dropped: null });
    return report(subject, null, active, true);
  }
  if (scenario === 'quality-failed') {
    const failed = run({
      status: 'failed',
      error: { code: 'provider_timeout', message: 'Timed out after 120 s' },
      findings: [],
      dropped: null,
      counts: noCounts,
    });
    return report(subject, null, failed, true);
  }
  const current = run({ findings: [finding] });
  return report(subject, current, current, true);
}

/** F-06 *Self-check* sample: the same claim, as the author sees it before submitting. */
export function visualSelfCheck(): S['QualityReportDto'] {
  const current = run({
    id: uuid(1300),
    trigger: 'self_check',
    dropped: { unknownRule: 0, unknownBlock: 0, emptyQuote: 0, quoteNotFound: 0, total: 0 },
    findings: [
      {
        id: uuid(1301),
        rule: 'understated-reason',
        ruleTitle: 'Reason understates the change',
        severity: 'warning',
        message: 'Adds a claim (“little extra sectioning”) that the reason doesn’t mention.',
        block: 'proposed',
        quote: 'gives little extra sectioning',
        lineStart: 14,
        lineEnd: 14,
        origin: 'model',
        original: null,
      },
    ],
  });
  return report({ kind: 'draft', id: uuid(0xd1), slug: null }, current, current, false);
}

/** F-14 *Models* sample: the frame's quality-check model and local endpoint. */
export const visualModels: S['ModelsDto'] = {
  jobs: [
    {
      kind: 'quality_check',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      maxTokens: 4096,
      timeoutS: 120,
      maxAttempts: 3,
      overridden: false,
    },
  ],
  openaiCompat: { baseUrl: 'http://models.internal:8000' },
  lastUsed: [
    {
      kind: 'quality_check',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      promptVersion: 'quality-v1',
      at: '2026-11-23T10:07:00.000Z',
    },
  ],
};

const ruleTitles = [
  ['unsourced-claim', 'Claim without evidence'],
  ['citation-mismatch', 'Citation does not support the claim'],
  ['unexplained-removal', 'Sourced content removed without reason'],
  ['vague-wording', 'Vague or weasel wording'],
  ['understated-reason', 'Reason understates the change'],
  ['dropped-hedge', 'Dropped hedge'],
] as const;

export const visualRules: S['RulesDto'] = {
  path: 'rules/quality.md',
  sha256: rulesSha,
  size: 3969,
  error: null,
  preamble: '',
  rules: ruleTitles.map(([id, title]) => ({ id, title, body: '' })),
};

const job = (n: number, overrides: Partial<S['JobListItemDto']>): S['JobListItemDto'] => ({
  id: uuid(1400 + n),
  kind: 'quality_check',
  trigger: 'submit',
  status: 'succeeded',
  subject: { kind: 'proposal', slug: 'fix-pinhole-units', title: 'Pinhole units and sectioning' },
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  promptVersion: 'quality-v1',
  tokensIn: 1840,
  tokensOut: 212,
  findings: 1,
  error: null,
  createdAt: '2026-11-23T10:05:20.000Z',
  startedAt: '2026-11-23T10:05:20.000Z',
  finishedAt: '2026-11-23T10:07:00.000Z',
  durationMs: 100_000,
  ...overrides,
});

const visualJobItems: S['JobListItemDto'][] = [
  job(1, {
    status: 'queued',
    subject: { kind: 'proposal', slug: 'new-sted-page', title: 'New page: STED microscopy' },
    createdAt: '2026-11-23T11:59:20.000Z',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    provider: null,
    model: null,
    promptVersion: null,
    tokensIn: null,
    tokensOut: null,
    findings: null,
  }),
  job(2, {
    trigger: 'self_check',
    subject: { kind: 'draft', slug: null, title: null },
    findings: 0,
    createdAt: '2026-11-23T09:40:00.000Z',
    finishedAt: '2026-11-23T09:40:50.000Z',
    durationMs: 50_000,
  }),
  job(0, {}),
];

/** F-13 *Background jobs* sample: quality_check · 10:07 · 1 min 40 s · OK · 1 waiting. */
export function visualJobs(params: URLSearchParams): S['JobListDto'] {
  const kind = params.get('kind');
  const status = params.get('status');
  const last = visualJobItems[2] ?? null;
  return {
    kinds: [{ kind: 'quality_check', queued: 1, running: 0, failed24h: 0, last }],
    items: visualJobItems.filter(
      (item) => (!kind || item.kind === kind) && (!status || item.status === status),
    ),
    nextCursor: null,
  };
}
