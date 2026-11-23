import { renderStatusBlock } from '@md-wiki/domain';
import { describe, expect, it } from 'vitest';
import {
  emptySummary,
  visualJobs,
  visualModels,
  visualProposalQuality,
  visualRules,
  visualSelfCheck,
} from '../src/dev/fixtures/quality';
import { visualArtifact } from '../src/dev/fixtures/review';
import { invalidationsFor } from '../src/lib/events';
import { jobKindRows, jobResult, jobRows, workerQueueHealth } from '../src/features/ops/model';
import {
  artifactLineOffset,
  droppedText,
  durationText,
  findingPlace,
  findingRows,
  jobErrorText,
  markDiffRows,
  markQuotes,
  qualityCard,
  qualityCell,
  quotesOnLine,
  runMeta,
  type FindingDto,
  type QualityReportDto,
  type QualityRunDto,
} from '../src/features/quality/model';
import { modelsRows } from '../src/features/settings/model';

function need<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture value missing');
  return value;
}

const report = visualProposalQuality(visualArtifact, null);
const run = need(report.current);
const finding = need(run.findings[0]);
const withRuns = (
  current: QualityRunDto | null,
  latest: QualityRunDto | null,
): QualityReportDto => ({
  ...report,
  current,
  latest,
  runs: latest ? [latest] : [],
});

describe('quality findings (system-logic §7.6)', () => {
  it('offsets proposal lines by the preview status block (D-33)', () => {
    const offset = artifactLineOffset(visualArtifact);
    expect(offset).toBeGreaterThan(0);
    expect(artifactLineOffset('## Plain\n')).toBe(0);
    expect(artifactLineOffset(null)).toBe(0);
    expect(artifactLineOffset('')).toBe(0);
    const crlf = renderStatusBlock({
      proposal: 'p',
      decision: '00000000-0000-4000-8000-000000000001',
      reviewer: 'agent',
      decided_at: '2026-11-23T10:00:00Z',
      lineEnding: '\r\n',
    });
    expect(artifactLineOffset(`${crlf}Body\r\n`)).toBe(crlf.split('\n').length - 1);
    expect(findingPlace(finding, offset)).toEqual({ text: 'Line 14', line: 14 });
  });

  it('names where a quote is: lines of the proposal, or its data block', () => {
    const at = (block: string, lineStart: number | null, lineEnd: number | null = lineStart) =>
      findingPlace({ block, lineStart, lineEnd }).text;
    expect(at('proposed', 3, 5)).toBe('Lines 3–5');
    expect(at('proposed', 3, 3)).toBe('Line 3');
    expect(at('proposed', null)).toBe('Proposal');
    expect(findingPlace({ block: 'proposed', lineStart: null, lineEnd: null }).line).toBeNull();
    expect(at('title', 1)).toBe('Title');
    expect(at('reason', 1)).toBe('Reason');
    expect(at('base', 7)).toBe('Current page, line 7');
    expect(at('source-2', 4, 6)).toBe('Source 2, lines 4–6');
    expect(at('source-1', null)).toBe('Source 1');
    expect(at('odd-block', 2)).toBe('odd-block, line 2');
    // Only proposal lines link into Changes.
    expect(findingPlace({ block: 'base', lineStart: 7, lineEnd: 7 }).line).toBeNull();
  });

  it('maps severities to the frame words and keeps the hedged original', () => {
    const hedge: FindingDto = {
      ...finding,
      id: 'h',
      severity: 'blocking',
      origin: 'rule',
      ruleTitle: null,
      rule: 'dropped-hedge',
      original: { block: 'source-1', text: 'may give little extra sectioning' },
    };
    const rows = findingRows([finding, { ...finding, id: 'i', severity: 'info' }, hedge]);
    expect(rows.map(({ severity }) => severity)).toEqual(['medium', 'low', 'high']);
    expect(rows[2]).toMatchObject({
      rule: 'dropped-hedge',
      original: 'may give little extra sectioning',
    });
    expect(rows[0]?.rule).toBe('Reason understates the change');
  });

  it('words dropped findings and the run meta', () => {
    expect(droppedText(null)).toBeNull();
    expect(droppedText({ ...need(run.dropped), quoteNotFound: 0, total: 0 })).toBeNull();
    expect(droppedText(run.dropped)).toBe('1 finding dropped: its quote was not in the proposal');
    expect(
      droppedText({ unknownRule: 0, unknownBlock: 0, emptyQuote: 0, quoteNotFound: 2, total: 2 }),
    ).toBe('2 findings dropped: their quotes were not in the proposal');
    expect(
      droppedText(
        { unknownRule: 1, unknownBlock: 0, emptyQuote: 0, quoteNotFound: 1, total: 2 },
        'your draft',
      ),
    ).toBe('2 findings dropped: could not be checked against your draft');
    expect(runMeta(run)).toBe(
      '1 finding dropped: its quote was not in the proposal · claude-sonnet-5-5 · quality.md 3f2a91',
    );
    expect(runMeta({ ...run, dropped: null, rulesChanged: true, model: null })).toBe(
      'quality.md 3f2a91 (rules changed since)',
    );
  });

  it('turns worker failure codes into words', () => {
    expect(jobErrorText({ code: 'provider_timeout', message: 'x' })).toBe(
      'the model provider timed out',
    );
    expect(jobErrorText({ code: 'superseded', message: 'x' })).toBe('a newer check replaced it');
    expect(jobErrorText({ code: 'brand_new', message: 'x' })).toBe('it stopped (brand_new)');
    expect(jobErrorText(null)).toBe('it stopped without a result');
  });
});

describe('quality card states (D-148)', () => {
  const offset = artifactLineOffset(visualArtifact);
  const active = { ...run, id: 'n', status: 'running' as const, findings: [], finishedAt: null };
  const failed = {
    ...run,
    id: 'f',
    status: 'failed' as const,
    findings: [],
    error: { code: 'rate_limited', message: '429' },
  };

  it('shows the current run’s findings', () => {
    const card = qualityCard(report, { subject: 'proposal', offset });
    expect(card).toMatchObject({ state: 'findings', note: null, active: false, flags: [] });
    expect(card.rows[0]).toMatchObject({ place: 'Line 14', line: 14, severity: 'medium' });
  });

  it('keeps current findings while a newer run is active or failed', () => {
    expect(qualityCard(withRuns(run, active), { subject: 'proposal' })).toMatchObject({
      state: 'findings',
      note: 'A new check is running…',
      active: true,
    });
    expect(
      qualityCard(withRuns(run, { ...active, status: 'queued' }), { subject: 'proposal' }).note,
    ).toBe('A new check is queued.');
    expect(qualityCard(withRuns(run, failed), { subject: 'proposal' }).note).toBe(
      'The last check failed: the model provider is rate limiting requests. Review works without it.',
    );
  });

  it('clean, none, active, failed and stale without a current run', () => {
    const clean = { ...run, findings: [], dropped: null };
    expect(qualityCard(withRuns(clean, clean), { subject: 'proposal' })).toMatchObject({
      state: 'clean',
      note: 'No findings.',
      rows: [],
    });
    expect(qualityCard(withRuns(clean, active), { subject: 'proposal' }).note).toBe(
      'A new check is running… No findings.',
    );
    expect(qualityCard(withRuns(null, null), { subject: 'proposal' })).toMatchObject({
      state: 'none',
      note: 'No quality check has run on this proposal.',
    });
    expect(qualityCard(withRuns(null, null), { subject: 'draft' }).note).toBe(
      'Check your draft against the quality rules before you submit.',
    );
    expect(qualityCard(withRuns(null, active), { subject: 'proposal' })).toMatchObject({
      state: 'active',
      note: 'Quality check running…',
      active: true,
    });
    expect(qualityCard(withRuns(null, failed), { subject: 'draft' })).toMatchObject({
      state: 'failed',
      note: 'The last check failed: the model provider is rate limiting requests.',
    });
    // A stale run (other hash) never shows its findings as current (D-135).
    const stale = { ...run, current: false };
    expect(qualityCard(withRuns(null, stale), { subject: 'draft' })).toMatchObject({
      state: 'stale',
      rows: [],
      note: 'You changed the draft since the last check. Run it again to check this version.',
    });
    expect(qualityCard(withRuns(null, stale), { subject: 'proposal' }).note).toBe(
      'The last check ran on another version. Its findings are not shown.',
    );
  });

  it('lists the advisory flags in words', () => {
    const flagged = {
      ...report,
      summary: { ...report.summary, flags: ['blocking_finding', 'dropped_hedge', 'check_failed'] },
    } satisfies QualityReportDto;
    expect(qualityCard(flagged, { subject: 'proposal' }).flags).toEqual([
      'High-severity finding',
      'A hedge from the source was dropped',
      'The last check failed',
    ]);
    expect(qualityCard(visualSelfCheck(), { subject: 'draft' }).meta).toBe(
      'claude-sonnet-5-5 · quality.md 3f2a91',
    );
  });
});

describe('F-09 Quality cell (D-149)', () => {
  it('uses the frame copy', () => {
    expect(qualityCell(emptySummary)).toBe('—');
    expect(qualityCell({ ...emptySummary, status: 'queued' })).toBe('Running');
    expect(qualityCell({ ...emptySummary, status: 'running' })).toBe('Running');
    expect(qualityCell({ ...emptySummary, status: 'failed', flags: ['check_failed'] })).toBe(
      'Check failed',
    );
    expect(qualityCell({ ...emptySummary, status: 'succeeded', current: true })).toBe(
      'No findings',
    );
    expect(qualityCell({ ...emptySummary, status: 'succeeded', current: true, findings: 1 })).toBe(
      '1 finding',
    );
    expect(qualityCell({ ...emptySummary, status: 'succeeded', current: true, findings: 3 })).toBe(
      '3 findings',
    );
    // Succeeded but stale: nothing current to report.
    expect(qualityCell({ ...emptySummary, status: 'succeeded', current: false, findings: 2 })).toBe(
      '—',
    );
  });
});

describe('quote marks in Changes', () => {
  it('splits text around every occurrence, merging overlaps', () => {
    expect(markQuotes('abc abc', ['abc'])).toEqual([
      { text: 'abc', mark: true },
      { text: ' ', mark: false },
      { text: 'abc', mark: true },
    ]);
    expect(markQuotes('abcdef', ['bcd', 'cde'])).toEqual([
      { text: 'a', mark: false },
      { text: 'bcd', mark: true },
      { text: 'e', mark: true },
      { text: 'f', mark: false },
    ]);
    expect(markQuotes('abc', ['zzz', ''])).toEqual([{ text: 'abc', mark: false }]);
    expect(markQuotes('', ['a'])).toEqual([{ text: '', mark: false }]);
  });

  it('marks only proposal quotes on their (offset) lines', () => {
    const multi: FindingDto = { ...finding, id: 'm', lineStart: 2, lineEnd: 3, quote: 'one\ntwo' };
    const base: FindingDto = { ...finding, id: 'b', block: 'base' };
    expect(quotesOnLine([multi, base], 6, 4)).toEqual(['one']);
    expect(quotesOnLine([multi], 7, 4)).toEqual(['two']);
    expect(quotesOnLine([multi], 8, 4)).toEqual([]);
    expect(quotesOnLine([{ ...finding, lineStart: null }], 14, 0)).toEqual([]);
    const rows = markDiffRows(
      [
        { kind: 'del' as const, number: 14, text: 'gives little extra sectioning' },
        { kind: 'add' as const, number: 14, text: 'x gives little extra sectioning y' },
        { kind: 'gap' as const, number: null, text: '3 unchanged lines' },
      ],
      [finding],
      artifactLineOffset(visualArtifact),
    );
    expect(rows[0]?.parts).toBeUndefined();
    expect(rows[1]?.parts?.filter(({ mark }) => mark).map(({ text }) => text)).toEqual([
      'gives little extra sectioning',
    ]);
    expect(markDiffRows([{ kind: 'add', number: 1, text: 'a' }], [], 0)).toEqual([
      { kind: 'add', number: 1, text: 'a' },
    ]);
  });
});

describe('durations', () => {
  it('formats seconds, minutes and hours', () => {
    expect(durationText(null)).toBeNull();
    expect(durationText(-1)).toBeNull();
    expect(durationText(0)).toBe('0 s');
    expect(durationText(52_000)).toBe('52 s');
    expect(durationText(100_000)).toBe('1 min 40 s');
    expect(durationText(120_000)).toBe('2 min');
    expect(durationText(3_600_000)).toBe('1 h');
    expect(durationText(3_900_000)).toBe('1 h 5 min');
  });
});

describe('Operations jobs (D-152)', () => {
  const list = visualJobs(new URLSearchParams());

  it('summarises each job kind as the frame draws it', () => {
    expect(jobKindRows(list.kinds)).toEqual([
      {
        key: 'quality_check',
        name: 'quality_check',
        last: '10:07 · 1 min 40 s',
        result: 'OK',
        tone: 'published',
        queue: '1 waiting',
      },
    ]);
    const kind = need(list.kinds[0]);
    const failedLast = {
      ...need(kind.last),
      status: 'failed' as const,
      error: { code: 'provider_error', message: '' },
    };
    expect(
      jobKindRows([{ ...kind, queued: 0, running: 2, failed24h: 3, last: failedLast }])[0],
    ).toMatchObject({
      result: 'Failed: the model provider returned an error · 3 failed in 24 h',
      tone: 'error',
      queue: '2 running',
    });
    expect(jobKindRows([{ ...kind, queued: 0, failed24h: 1 }])[0]).toMatchObject({
      result: 'OK · 1 failed in 24 h',
      tone: 'pending',
      queue: '0',
    });
    expect(jobKindRows([{ ...kind, last: null }])[0]).toMatchObject({
      last: '—',
      result: 'No runs yet',
      tone: 'closed',
    });
  });

  it('computes the worker queue health card', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    expect(workerQueueHealth(list.kinds, list.items, now)).toEqual({
      value: '1 job',
      note: 'Oldest 40 s',
      tone: 'published',
    });
    const idle = list.kinds.map((kind) => ({ ...kind, queued: 0, running: 0 }));
    expect(workerQueueHealth(idle, [], now).note).toBe('Nothing waiting');
    expect(
      workerQueueHealth(
        idle.map((k) => ({ ...k, running: 2 })),
        [],
        now,
      ),
    ).toMatchObject({
      value: '2 jobs',
      note: 'None waiting',
    });
  });

  it('lists runs as metadata; drafts stay private', () => {
    const rows = jobRows([list]);
    expect(rows.map(({ subject }) => subject.text)).toEqual([
      'new-sted-page',
      'Private draft',
      'fix-pinhole-units',
    ]);
    expect(rows[0]).toMatchObject({
      result: 'Waiting',
      tone: 'pending',
      model: '—',
      tokens: '—',
      duration: '—',
    });
    expect(rows[1]).toMatchObject({ trigger: 'Self-check', result: 'OK', duration: '50 s' });
    expect(rows[2]).toMatchObject({
      trigger: 'On submit',
      result: 'OK · 1 finding',
      model: 'claude-sonnet-5-5 · quality-v1',
      tokens: '1840 in · 212 out',
    });
    const item = need(list.items[0]);
    expect(jobResult({ ...item, status: 'running' })).toEqual({
      text: 'Running',
      tone: 'publishing',
    });
    expect(jobRows([{ ...list, items: [{ ...item, subject: null }] }])[0]?.subject.text).toBe('—');
  });
});

describe('Settings › Models rows (D-151)', () => {
  it('shows the effective config, local endpoint and rules', () => {
    const rows = modelsRows(visualModels, visualRules);
    expect(rows.map(({ label, value }) => [label, value])).toEqual([
      ['Quality check', 'claude-sonnet-5-5'],
      ['Local model', 'http://models.internal:8000'],
      ['Quality rules', 'rules/quality.md'],
    ]);
    expect(rows[1]?.note).toBe('No job uses it yet.');
    expect(rows[2]).toMatchObject({ locked: true, note: '6 rules · version 3f2a91 · 3969 bytes' });
    expect(rows[2]?.items[0]).toEqual({
      key: 'unsourced-claim',
      text: 'Claim without evidence',
      note: ' · unsourced-claim',
    });
  });

  it('handles a local model in use, no endpoint, an override, no last use and a broken rules file', () => {
    const job = need(visualModels.jobs[0]);
    const local = modelsRows(
      {
        ...visualModels,
        jobs: [
          { ...job, provider: 'openai_compat', model: 'qwen3.8', overridden: true, maxAttempts: 1 },
        ],
        lastUsed: [],
      },
      { ...visualRules, error: 'invalid UTF-8', rules: [], sha256: null, size: null },
    );
    expect(local[0]?.note).toBe(
      'openai_compat · up to 4096 tokens · 120 s timeout · 1 attempt · set for this job. Not used yet.',
    );
    expect(local[1]).toMatchObject({ value: 'http://models.internal:8000 · qwen3.8', note: '' });
    expect(local[2]).toMatchObject({
      note: 'Not usable: invalid UTF-8. Quality checks fail until the file is fixed.',
      items: [],
    });
    const none = modelsRows({ ...visualModels, openaiCompat: { baseUrl: null } }, visualRules);
    expect(none[1]).toMatchObject({
      value: 'Not configured',
      note: 'Set OPENAI_COMPAT_BASE_URL in the server environment to use one.',
    });
  });
});

describe('SSE quality.changed (§7.6.7, D-144)', () => {
  it('invalidates the proposal, lists, report, self-check and jobs', () => {
    expect(invalidationsFor({ type: 'quality.changed', slug: 's' })).toEqual([
      ['proposal', 's'],
      ['proposals'],
      ['quality', 's'],
      ['ops', 'jobs'],
    ]);
    expect(invalidationsFor({ type: 'quality.changed', draftId: 'd' })).toEqual([
      ['draft', 'd', 'self-check'],
      ['ops', 'jobs'],
    ]);
  });
});
