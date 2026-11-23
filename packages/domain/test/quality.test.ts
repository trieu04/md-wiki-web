import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addDrops,
  checkFinding,
  currentRun,
  draftDigest,
  isActiveRun,
  locateQuote,
  normalizeQuote,
  parseQualityRules,
  QUALITY_LEASE_MS,
  qualityFlags,
  qualitySummary,
  sha256Hex,
  verifyFindings,
  type RunFacts,
} from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);

// Same fixture as services/worker/tests/test_quality_fencing_rules.py (parsers must agree).
const RULES = `# Contribution quality

Intro text that is not a rule.

## Unsourced claim

Adds a claim without declared evidence.

## Own experimental results {#own-results}

Own results belong only in \`## Lab notes\`.

\`\`\`markdown
## Not a rule (inside a code fence)
\`\`\`
`;

describe('parseQualityRules', () => {
  it('reads level-two headings with slug or explicit ids, outside code fences', () => {
    const parsed = parseQualityRules(enc(RULES));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.rules.map((r) => r.id)).toEqual(['unsourced-claim', 'own-results']);
    expect(parsed.value.rules[1]?.title).toBe('Own experimental results');
    expect(parsed.value.rules[0]?.body).toBe('Adds a claim without declared evidence.');
    expect(parsed.value.rules[1]?.body).toContain('## Not a rule');
    expect(parsed.value.preamble).toBe('# Contribution quality\n\nIntro text that is not a rule.');
    expect(parsed.value.sha256).toBe(sha256Hex(enc(RULES)));
  });

  it('hashes the raw bytes while tolerating BOM and CRLF', () => {
    const raw = enc(`\ufeff${RULES.replaceAll('\n', '\r\n')}`);
    const parsed = parseQualityRules(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.sha256).toBe(sha256Hex(raw));
    expect(parsed.value.rules.map((r) => r.id)).toEqual(['unsourced-claim', 'own-results']);
  });

  it.each([
    ['empty', new Uint8Array()],
    ['no rules', enc('# Title only\n\nno rules\n')],
    ['duplicate ids', enc('## A\n\n## a\n')],
    ['no usable id', enc('## !!!\n')],
    ['invalid UTF-8', new Uint8Array([0xff, 0xfe, 0x23, 0x23, 0x20, 0x62])],
    ['over 64 KiB', enc(`## R\n${'x'.repeat(64 * 1024)}`)],
  ])('refuses an unusable file: %s', (_name, raw) => {
    expect(parseQualityRules(raw).ok).toBe(false);
  });

  it('accepts the repository rules file with stable ids', () => {
    const raw = readFileSync(new URL('../../../rules/quality.md', import.meta.url));
    const parsed = parseQualityRules(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.rules.map((r) => r.id)).toEqual([
      'unsourced-claim',
      'citation-mismatch',
      'unexplained-removal',
      'vague-wording',
      'promotional-language',
      'editorial-language',
      'off-topic',
      'redundant-content',
      'broken-markup',
      'language-quality',
      'understated-reason',
      'own-result-in-body',
      'own-result-no-data',
      'own-result-misreported',
      'dropped-hedge',
    ]);
  });
});

describe('normalizeQuote and locateQuote', () => {
  it('collapses Unicode whitespace incl. NBSP, zero-width and BOM, and applies NFC', () => {
    expect(normalizeQuote(' a\u00a0\u200b b\n\tc\ufeff ')).toBe('a b c');
    expect(normalizeQuote('é')).toBe('é');
    expect(normalizeQuote('a\u001fb')).toBe('a b');
    expect(normalizeQuote(' \u2060 ')).toBe('');
  });

  it('finds 1-based lines of a quote that spans a line break', () => {
    const text = '# T\n\nFirst line ends\nhere and goes on.\n\nOther.\n';
    expect(locateQuote('ends here', text)).toEqual({ lineStart: 3, lineEnd: 4 });
    expect(locateQuote('Other.', text)).toEqual({ lineStart: 6, lineEnd: 6 });
    expect(locateQuote('# T', text)).toEqual({ lineStart: 1, lineEnd: 1 });
  });

  it('handles composed characters, astral characters and misses', () => {
    expect(locateQuote('café au', 'x\ncafé\n au lait')).toEqual({
      lineStart: 2,
      lineEnd: 3,
    });
    expect(locateQuote('😀 b', 'a\n😀 b')).toEqual({ lineStart: 2, lineEnd: 2 });
    expect(locateQuote('absent', 'text')).toBeNull();
    expect(locateQuote('  ', 'text')).toBeNull();
    expect(locateQuote('Case', 'case')).toBeNull();
  });
});

describe('verifyFindings', () => {
  const blocks = new Map([
    ['proposed', 'The lens may resolve\n200 nm.'],
    ['base', 'The lens may resolve 200 nm in vitro.'],
  ]);
  const rules = new Set(['unsourced-claim', 'dropped-hedge']);
  const f = (rule: string, block: string, text: string, original?: [string, string]) => ({
    rule,
    quote: { block, text },
    ...(original && { original: { block: original[0], text: original[1] } }),
  });

  it('drops findings with unknown rules, blocks, empty or invented quotes and counts them', () => {
    const findings = [
      f('unsourced-claim', 'proposed', 'may resolve 200 nm'),
      f('made-up', 'proposed', 'may resolve'),
      f('unsourced-claim', 'nowhere', 'may resolve'),
      f('unsourced-claim', 'proposed', ' \u200b '),
      f('unsourced-claim', 'proposed', 'resolves 100 nm'),
      f('unsourced-claim', 'proposed', 'MAY resolve'),
      f('unsourced-claim', 'proposed', 'may  resolve\n200 nm'),
      f('dropped-hedge', 'proposed', 'may resolve', ['base', 'in vitro']),
      f('dropped-hedge', 'proposed', 'may resolve', ['ghost', 'in vitro']),
      f('dropped-hedge', 'proposed', 'resolve', ['base', 'in vivo']),
    ];
    const { kept, dropped } = verifyFindings(findings, blocks, rules);
    expect(kept).toEqual([findings[0], findings[7]]);
    expect(dropped).toEqual({ unknownRule: 1, unknownBlock: 2, emptyQuote: 1, quoteNotFound: 3 });
  });

  it('reports the single reason of one finding', () => {
    expect(checkFinding(f('unsourced-claim', 'base', 'in vitro'), blocks, rules)).toBeNull();
    expect(checkFinding(f('x', 'nowhere', ''), blocks, rules)).toBe('unknownRule');
  });

  it('adds drop counts', () => {
    expect(
      addDrops(
        { unknownRule: 1, unknownBlock: 0, emptyQuote: 2, quoteNotFound: 0 },
        { quoteNotFound: 3 },
      ),
    ).toEqual({ unknownRule: 1, unknownBlock: 0, emptyQuote: 2, quoteNotFound: 3 });
  });
});

describe('runs, freshness and flags', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const run = (over: Partial<RunFacts>): RunFacts => ({
    status: 'succeeded',
    bundleHash: 'a',
    createdAt: now,
    counts: { info: 0, warning: 0, blocking: 0 },
    ruleFindings: 0,
    ...over,
  });

  it('a run is active while queued or running within the lease', () => {
    expect(isActiveRun(run({ status: 'queued' }), now)).toBe(true);
    expect(isActiveRun(run({ status: 'running' }), now)).toBe(true);
    expect(isActiveRun(run({ status: 'succeeded' }), now)).toBe(false);
    const old = new Date(now.getTime() - QUALITY_LEASE_MS);
    expect(isActiveRun(run({ status: 'running', createdAt: old }), now)).toBe(false);
  });

  it('the current run is the latest succeeded run on the current hash; stale runs never count', () => {
    const stale = run({ bundleHash: 'old', counts: { info: 0, warning: 0, blocking: 2 } });
    const failed = run({ status: 'failed' });
    const good = run({ counts: { info: 1, warning: 1, blocking: 0 } });
    expect(currentRun([failed, stale, good], 'a')).toBe(good);
    expect(currentRun([stale], 'a')).toBeNull();
    expect(qualitySummary([stale], 'a')).toEqual({
      status: 'succeeded',
      findings: 0,
      counts: { info: 0, warning: 0, blocking: 0 },
      flags: [],
      current: false,
    });
    expect(qualitySummary([failed, stale, good], 'a')).toEqual({
      status: 'failed',
      findings: 2,
      counts: { info: 1, warning: 1, blocking: 0 },
      flags: ['check_failed'],
      current: true,
    });
    expect(qualitySummary([], 'a')).toMatchObject({ status: 'none', findings: 0, flags: [] });
  });

  it('flags blocking findings, dropped hedges and a failed latest run, in order', () => {
    const current = run({ counts: { info: 0, warning: 1, blocking: 1 }, ruleFindings: 1 });
    expect(qualityFlags(current, run({ status: 'failed' }))).toEqual([
      'blocking_finding',
      'dropped_hedge',
      'check_failed',
    ]);
    expect(qualityFlags(null, null)).toEqual([]);
  });
});

describe('draftDigest', () => {
  const base = {
    targetPath: 'a.md',
    baseSha256: 'b'.repeat(64),
    section: null,
    proposedSha256: 'c'.repeat(64),
    title: '',
    reason: 'r',
    sources: [{ path: 's.md', sha256: 'd'.repeat(64) }],
  };
  it('is stable and changes with every bound field', () => {
    expect(draftDigest(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(draftDigest({ ...base })).toBe(draftDigest(base));
    for (const change of [
      { targetPath: 'b.md' },
      { baseSha256: null },
      { section: 'x' },
      { proposedSha256: 'e'.repeat(64) },
      { title: 't' },
      { reason: 'r2' },
      { sources: [] },
    ])
      expect(draftDigest({ ...base, ...change })).not.toBe(draftDigest(base));
  });
});
