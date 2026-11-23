import { describe, expect, it } from 'vitest';
import {
  aliasKeys,
  attestationIssues,
  attestationState,
  bodyHash,
  buildDigest,
  can,
  citedSources,
  computeSectionLabel,
  contradictionApplies,
  deliveryFor,
  descendants,
  detectRenames,
  labelInputFromEvidence,
  linkedPaths,
  meetsThreshold,
  normalizeSourceRef,
  ownersOf,
  parseOwners,
  parseSourceTiers,
  prefsFromRows,
  provenanceGroups,
  queueOrder,
  reciprocalPairs,
  reportRateLimit,
  retentionCutoff,
  retentionPlan,
  rowsFromPrefs,
  splitSections,
  teamCounts,
  tierOf,
  validateGateChange,
  type SectionEvidence,
} from '../src/index.js';

const H = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const t = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString();

describe('cited sources and links (D-176)', () => {
  it('normalizes DOIs, doi.org links and URLs', () => {
    expect(normalizeSourceRef(' 10.1038/NMETH.2019 ')).toBe('doi:10.1038/nmeth.2019');
    expect(normalizeSourceRef('https://doi.org/10.1101/2020.01.01.123.')).toBe(
      'doi:10.1101/2020.01.01.123',
    );
    expect(normalizeSourceRef('DOI:10.1/X')).toBe('doi:10.1/x');
    expect(normalizeSourceRef('https://zeiss.com/lsm980#specs')).toBe('url:https://zeiss.com/lsm980');
    expect(normalizeSourceRef('Pawley, Handbook, Table 2.1')).toBe('Pawley, Handbook, Table 2.1');
  });
  it('finds DOIs and links once, in order, without double-counting doi.org links', () => {
    const text =
      'See [paper](https://doi.org/10.1038/abc) and 10.1101/xyz, also <https://fpbase.org/x>; ' +
      'again 10.1038/ABC and https://example.org/page.';
    expect(citedSources(text)).toEqual([
      'doi:10.1038/abc',
      'doi:10.1101/xyz',
      'url:https://fpbase.org/x',
      'url:https://example.org/page',
    ]);
    expect(citedSources('no sources here')).toEqual([]);
  });
  it('resolves relative wiki links and ignores external and self links', () => {
    expect(
      linkedPaths(
        'See [a](../other/page.md#x), [b](same.md), [[topic/wiki-link]], [c](https://x.org/a.md), [me](self.md)',
        'imaging/self.md',
      ),
    ).toEqual(['topic/wiki-link.md', 'other/page.md', 'imaging/same.md']);
  });
});

describe('source tiers (D-175)', () => {
  const today = new Date('2026-11-24T00:00:00Z');
  const file = [
    '# Source tiers',
    '',
    '| Source | Match | Tier | Reason | Reviewed |',
    '| --- | --- | --- | --- | --- |',
    '| Preprints | doi:10.1101/ | low | Not peer reviewed | 2026-01-10 |',
    '| Nature | doi:10.1038/ | high | Peer reviewed | 2024-01-01 |',
    '| Old list | url:https://old.example/ | medium | Legacy | 2020-01-01 |',
    '| Bad | url:https://bad/ | great | ? | 2026-01-01 |',
    '| Dup | doi:10.1101/ | high | dup | 2026-01-01 |',
    '| Date | url:https://d/ | low | x | 2026-02-30 |',
  ].join('\n');
  it('parses rows and warns on bad tier, duplicate, bad date and stale review', () => {
    const { tiers, warnings } = parseSourceTiers(file, today);
    expect(tiers.map((x) => [x.match, x.tier])).toEqual([
      ['doi:10.1101/', 'low'],
      ['doi:10.1038/', 'high'],
      ['url:https://old.example/', 'medium'],
      ['url:https://d/', 'low'],
    ]);
    expect(warnings.map((w) => w.code)).toEqual([
      'STALE_REVIEW',
      'BAD_TIER',
      'DUPLICATE_MATCH',
      'BAD_DATE',
    ]);
  });
  it('warns when the table or columns are missing', () => {
    expect(parseSourceTiers('nothing', today).warnings[0]?.code).toBe('NO_TABLE');
    const partial = parseSourceTiers('| Match | Tier |\n|---|---|\n| doi:10.1/ | low |', today);
    expect(partial.warnings[0]?.code).toBe('MISSING_COLUMN');
    expect(partial.tiers).toHaveLength(1);
  });
  it('picks the longest matching prefix', () => {
    const { tiers } = parseSourceTiers(
      '| Source | Match | Tier | Reason | Reviewed |\n|-|-|-|-|-|\n| A | doi:10.1 | low | | |\n| B | doi:10.1101/ | high | | |',
      today,
    );
    expect(tierOf('doi:10.1101/abc', tiers)?.source).toBe('B');
    expect(tierOf('doi:10.1000/abc', tiers)?.source).toBe('A');
    expect(tierOf('url:https://x', tiers)).toBeNull();
  });
});

describe('anchor relinking (D-163)', () => {
  const before = splitSections('# Title\n\nLead.\n\n## Old name\n\nSame body.\n\n## Keep\n\nX.\n');
  it('links a pure heading rename one-to-one', () => {
    const after = splitSections('# Title\n\nLead.\n\n## New name\n\nSame body.\n\n## Keep\n\nX.\n');
    const renames = detectRenames(before, after);
    expect(renames).toEqual([
      expect.objectContaining({ oldAnchor: 'old-name', newAnchor: 'new-name' }),
    ]);
    expect(renames[0]?.oldHash).not.toBe(renames[0]?.newHash);
  });
  it('does not link when the body changed too, or the match is ambiguous', () => {
    const changed = splitSections('# Title\n\nLead.\n\n## New name\n\nOther body.\n\n## Keep\n\nX.\n');
    expect(detectRenames(before, changed)).toEqual([]);
    const twoOld = splitSections('## A\n\nSame.\n\n## B\n\nSame.\n');
    const twoNew = splitSections('## C\n\nSame.\n\n## D\n\nSame.\n');
    expect(detectRenames(twoOld, twoNew)).toEqual([]);
  });
  it('treats setext headings by their body', () => {
    const a = splitSections('Old\n===\n\nBody.\n');
    const b = splitSections('New\n===\n\nBody.\n');
    expect(bodyHash(a[0] ?? { level: 1, text: '' })).toBe(bodyHash(b[0] ?? { level: 1, text: '' }));
    expect(detectRenames(a, b)).toHaveLength(1);
  });
  it('follows chains of links back to every older key, cycle-safe', () => {
    const links = [
      { path: 'p.md', oldAnchor: 'a', oldHash: '1', newAnchor: 'b', newHash: '2' },
      { path: 'p.md', oldAnchor: 'b', oldHash: '2', newAnchor: 'c', newHash: '3' },
      { path: 'p.md', oldAnchor: 'c', oldHash: '3', newAnchor: 'b', newHash: '2' },
    ];
    expect(aliasKeys({ path: 'p.md', anchor: 'c', sectionHash: '3' }, links)).toEqual([
      { path: 'p.md', anchor: 'b', sectionHash: '2' },
      { path: 'p.md', anchor: 'a', sectionHash: '1' },
    ]);
  });
});

describe('page authors (D-164 by the D-206 rule)', () => {
  it('reads a `Pages | Email` table; the last matching row decides', () => {
    const file = parseOwners(
      '| Pages | Email |\n| --- | --- |\n| `imaging/**` | M.Nguyen@x, gone@x |\n| imaging/a.md | h.pham@x |\n',
    );
    expect(file.rules).toHaveLength(2);
    expect(ownersOf(file, 'imaging/a.md')).toEqual(['h.pham@x']);
    expect(ownersOf(file, 'imaging/sub/b.md').map((e) => e.toLowerCase())).toEqual([
      'm.nguyen@x',
      'gone@x',
    ]);
  });
});

describe('attestation rules (D-166, D-167)', () => {
  it('requires the per-kind fields and a change when it did not work as written', () => {
    expect(attestationIssues({ kind: 'useful' })).toEqual([]);
    expect(attestationIssues({ kind: 'checked' }).map((i) => i.code)).toEqual(['REQUIRED']);
    expect(attestationIssues({ kind: 'useful', checked: {} }).map((i) => i.path)).toEqual([
      'checked',
    ]);
    expect(
      attestationIssues({ kind: 'used', used: { worked: 'with_changes', change: ' ' } }).map(
        (i) => i.path,
      ),
    ).toEqual(['used.change']);
    expect(attestationIssues({ kind: 'used', used: { worked: 'yes' } })).toEqual([]);
  });
  it('derives the state from events, version binding and invalidation', () => {
    const current = new Set([H]);
    const ctx = { currentHashes: current, invalidated: false };
    expect(attestationState({ kind: 'checked', sectionHash: H }, [], ctx)).toBe('active');
    expect(attestationState({ kind: 'checked', sectionHash: OLD }, [], ctx)).toBe('on_old_version');
    expect(
      attestationState({ kind: 'checked', sectionHash: H }, [], { ...ctx, invalidated: true }),
    ).toBe('stale');
    expect(
      attestationState({ kind: 'used', sectionHash: H }, [{ status: 'downweighted' }], ctx),
    ).toBe('downweighted');
    expect(
      attestationState({ kind: 'used', sectionHash: H }, [{ status: 'withdrawn' }], ctx),
    ).toBe('withdrawn');
    expect(attestationState({ kind: 'report', sectionHash: OLD }, [], ctx)).toBe('open');
    expect(
      attestationState(
        { kind: 'report', sectionHash: OLD },
        [{ status: 'confirmed' }, { status: 'fixed' }],
        ctx,
      ),
    ).toBe('fixed');
  });
  it('rate limits reports to 5 per 7 days and says when to retry', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
    expect(reportRateLimit([days(1), days(2), days(3), days(4)], now)).toEqual({ ok: true });
    expect(reportRateLimit([days(1), days(2), days(3), days(4), days(8)], now)).toEqual({
      ok: true,
    });
    expect(reportRateLimit([days(1), days(2), days(3), days(4), days(6)], now)).toEqual({
      ok: false,
      retryAfterSeconds: 86_400,
    });
  });
  it('counts distinct people per team, never withdrawn or old-version ones, plus aggregates', () => {
    const rows = [
      { actorId: 'a', team: 'Imaging core', kind: 'checked', state: 'active' },
      { actorId: 'a', team: 'Imaging core', kind: 'checked', state: 'active' },
      { actorId: 'b', team: 'Imaging core', kind: 'checked', state: 'downweighted' },
      { actorId: 'c', team: null, kind: 'checked', state: 'withdrawn' },
      { actorId: 'd', team: 'Platform', kind: 'checked', state: 'on_old_version' },
      { actorId: 'e', team: 'Platform', kind: 'used', state: 'active' },
      { actorId: 'f', team: null, kind: 'useful', state: 'active' },
    ] as const;
    expect(teamCounts(rows, [{ metric: 'used', team: 'Platform', count: 2 }])).toEqual({
      checked: { people: 2, teams: [{ team: 'Imaging core', people: 2 }] },
      used: { people: 3, teams: [{ team: 'Platform', people: 3 }] },
      useful: 1,
    });
  });
  it('detects reciprocal pairs only when both directions exist', () => {
    expect(
      reciprocalPairs([
        { id: '1', actorId: 'a', authorIds: ['b'] },
        { id: '2', actorId: 'b', authorIds: ['a'] },
        { id: '3', actorId: 'c', authorIds: ['a'] },
        { id: '4', actorId: 'a', authorIds: ['a'] },
      ]),
    ).toEqual([{ people: ['a', 'b'], attestationIds: ['1', '2'] }]);
  });
  it('retention purges only final rows older than the cutoff and keeps counted aggregates', () => {
    const now = new Date('2026-11-24T00:00:00Z');
    const cutoff = retentionCutoff(now);
    expect(cutoff.toISOString()).toBe('2026-08-26T00:00:00.000Z');
    const old = new Date('2026-08-01T00:00:00Z');
    const plan = retentionPlan(
      [
        { id: '1', createdAt: old, final: true, counted: true, bucket: 'x' },
        { id: '2', createdAt: old, final: true, counted: false, bucket: 'x' },
        { id: '3', createdAt: old, final: false, counted: true, bucket: 'x' },
        { id: '4', createdAt: now, final: true, counted: true, bucket: 'x' },
        { id: '5', createdAt: old, final: true, counted: true, bucket: 'y' },
      ],
      cutoff,
    );
    expect(plan.purge).toEqual(['1', '2', '5']);
    expect([...plan.add]).toEqual([
      ['x', 1],
      ['y', 1],
    ]);
  });
});

describe('propagation, contradiction, queue (D-174, D-178, D-179)', () => {
  it('reaches every transitive descendant once, with depth, through cycles', () => {
    const edges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
      { from: 'B', to: 'D' },
      { from: 'X', to: 'Y' },
    ];
    expect(descendants(['A'], edges)).toEqual([
      { key: 'B', depth: 1 },
      { key: 'C', depth: 2 },
      { key: 'D', depth: 2 },
    ]);
  });
  it('lets only the strong side escape a contradiction', () => {
    expect(contradictionApplies(2, 0)).toBe(false);
    expect(contradictionApplies(2, 2)).toBe(true);
    expect(contradictionApplies(1, 0)).toBe(true);
    expect(contradictionApplies(0, 2)).toBe(true);
  });
  it('orders by reach, then blocking, then age', () => {
    const item = (id: string, linkedFrom: number, teams: number, blocking: boolean, at: number) => ({
      id,
      reach: { linkedFrom, teams },
      blocking,
      at: t(at),
    });
    expect(
      queueOrder([
        item('a', 0, 0, false, 1),
        item('b', 0, 0, true, 2),
        item('c', 1, 0, false, 3),
        item('d', 0, 2, false, 4),
        item('e', 0, 0, false, 0),
      ]).map((i) => i.id),
    ).toEqual(['c', 'd', 'b', 'e', 'a']);
  });
});

describe('label inputs from records (D-161)', () => {
  const base: SectionEvidence = {
    currentHash: H,
    reviews: [{ id: 'r', sectionHash: H, time: t(1), kind: 'agent' }],
    sourceChecks: [],
    ownerConfirmations: [],
    errors: [],
    flags: [],
    invalidations: [],
    clearedRetractions: new Set(),
    citedRefs: [],
    onHoldTopics: [],
    contradictions: [],
  };
  const label = (e: Partial<SectionEvidence>) =>
    computeSectionLabel(labelInputFromEvidence({ ...base, ...e })).label;
  const check = (over: Partial<SectionEvidence['sourceChecks'][number]> = {}) => ({
    id: 'c',
    sectionHash: H,
    time: t(2),
    checkerKind: 'person' as const,
    result: 'supported' as const,
    sourceRef: 'doi:10.1/a',
    ...over,
  });
  it('reaches every rule', () => {
    expect(label({ reviews: [] })).toBe('not_reviewed');
    expect(label({})).toBe('reviewed');
    expect(label({ sourceChecks: [check()] })).toBe('checked');
    expect(label({ ownerConfirmations: [{ id: 'o', sectionHash: H, time: t(2) }] })).toBe(
      'checked',
    );
    expect(label({ sourceChecks: [check({ result: 'not_supported' })] })).toBe('error');
    expect(label({ errors: [{ id: 'e', sectionHash: H, time: t(3), reason: 'wrong' }] })).toBe(
      'error',
    );
    expect(label({ sourceChecks: [check({ result: 'not_supported', checkerKind: 'agent' })] })).toBe(
      'recheck',
    );
    expect(label({ flags: [{ id: 'f', sectionHash: H, time: t(3), reason: 'Report confirmed' }] })).toBe(
      'recheck',
    );
    expect(label({ onHoldTopics: [{ id: 'x', time: t(4) }] })).toBe('recheck');
    expect(label({ contradictions: [{ id: 'k', time: t(4), applies: true }] })).toBe('recheck');
    expect(label({ contradictions: [{ id: 'k', time: t(4), applies: false }] })).toBe('reviewed');
  });
  it('a retraction of a cited source puts the section under re-check until cleared', () => {
    const retraction = { id: 'i', kind: 'retraction' as const, ref: 'doi:10.1/a', time: t(5) };
    expect(label({ citedRefs: ['doi:10.1/a'], invalidations: [retraction] })).toBe('recheck');
    expect(
      label({
        citedRefs: ['doi:10.1/a'],
        invalidations: [retraction],
        clearedRetractions: new Set(['i']),
      }),
    ).toBe('reviewed');
    expect(label({ citedRefs: ['doi:10.1/b'], invalidations: [retraction] })).toBe('reviewed');
  });
  it('an invalidation after a check makes it stop counting; concern and earlier events do not', () => {
    const at = (kind: 'retraction' | 'source_changed' | 'concern' | 'root_wrong', n: number) => ({
      id: kind,
      kind,
      ref: 'doi:10.1/a',
      time: t(n),
    });
    expect(label({ sourceChecks: [check()], invalidations: [at('source_changed', 5)] })).toBe(
      'reviewed',
    );
    expect(label({ sourceChecks: [check()], invalidations: [at('root_wrong', 5)] })).toBe(
      'reviewed',
    );
    expect(label({ sourceChecks: [check()], invalidations: [at('concern', 5)] })).toBe('checked');
    expect(label({ sourceChecks: [check()], invalidations: [at('source_changed', 1)] })).toBe(
      'checked',
    );
  });
  it('says "source not checkable" for an unverifiable check without a supported one', () => {
    const dto = computeSectionLabel(
      labelInputFromEvidence({ ...base, sourceChecks: [check({ result: 'unverifiable' })] }),
    );
    expect(dto).toMatchObject({ label: 'reviewed', reason: 'source not checkable' });
  });
  it('counts provenance groups by distinct valid supported refs on the current hash', () => {
    expect(
      provenanceGroups(
        [
          check(),
          check({ id: 'd', checkerKind: 'agent' }),
          check({ id: 'e', sourceRef: 'doi:10.1/b' }),
          check({ id: 'f', sourceRef: 'doi:10.1/c', sectionHash: OLD }),
          check({ id: 'g', sourceRef: 'doi:10.1/d', result: 'unverifiable' }),
        ],
        H,
        [],
      ),
    ).toBe(2);
  });
  it('applies the θ threshold only when the gate is on and a score exists', () => {
    expect(meetsThreshold(undefined)).toBe(true);
    const gate = { enabled: true, theta: 0.9, hysteresis: 0.02, p: 0.89, previous: null };
    expect(meetsThreshold(gate)).toBe(false);
    expect(meetsThreshold({ ...gate, previous: 'checked' })).toBe(true);
    expect(meetsThreshold({ ...gate, p: null })).toBe(true);
    expect(meetsThreshold({ ...gate, enabled: false })).toBe(true);
    expect(label({ sourceChecks: [check()], threshold: gate })).toBe('reviewed');
  });
});

describe('gates (D-177)', () => {
  const today = new Date('2026-11-24T10:00:00Z');
  it('needs a run record and a past date only to enable', () => {
    expect(validateGateChange({ enabled: false }, today)).toEqual([]);
    expect(validateGateChange({ enabled: true }, today).map((i) => `${i.path}:${i.code}`)).toEqual([
      'runRecord:REQUIRED',
      'runDate:REQUIRED',
    ]);
    expect(
      validateGateChange(
        { enabled: true, runRecord: '../etc/passwd', runDate: '2026-11-25' },
        today,
      ).map((i) => `${i.path}:${i.code}`),
    ).toEqual(['runRecord:INVALID', 'runDate:INVALID']);
    expect(
      validateGateChange(
        { enabled: true, runRecord: 'experiments/runs/e8d/run.json', runDate: '2026-11-24' },
        today,
      ),
    ).toEqual([]);
    expect(
      validateGateChange({ enabled: true, runRecord: 'x', runDate: '2026-02-30' }, today),
    ).toHaveLength(1);
  });
});

describe('notifications (D-172)', () => {
  it('maps preferences to rows and back, defaults on and wiki only', () => {
    expect(prefsFromRows([])).toEqual({
      events: { section_recheck: true, section_edited: true, report_outcome: true, weekly_summary: true },
      channel: 'wiki',
    });
    const prefs = {
      events: { section_recheck: true, section_edited: false, report_outcome: true, weekly_summary: false },
      channel: 'wiki_and_daily_email',
    } as const;
    expect(prefsFromRows(rowsFromPrefs(prefs))).toEqual(prefs);
  });
  it('delivers duty notices regardless of toggles, others only when on', () => {
    const prefs = prefsFromRows([
      { event: 'section_edited', channel: 'off' },
      { event: 'report_outcome', channel: 'off' },
    ]);
    expect(deliveryFor('section_edited', prefs)).toEqual({ inApp: false, email: false });
    expect(deliveryFor('report_outcome', prefs)).toEqual({ inApp: true, email: false });
    expect(deliveryFor('report_received', prefs)).toEqual({ inApp: true, email: false });
    expect(deliveryFor('weekly_summary', prefs)).toEqual({ inApp: false, email: false });
  });
  it('builds a digest grouped by page', () => {
    expect(buildDigest({ name: 'Ana' }, [], 'daily')).toBeNull();
    const digest = buildDigest(
      { name: 'Ana' },
      [
        { event: 'section_edited', path: 'b.md', pageTitle: 'Beta', text: 'B2', createdAt: t(2) },
        { event: 'section_edited', path: 'b.md', pageTitle: 'Beta', text: 'B1', createdAt: t(1) },
        { event: 'report_outcome', path: 'a.md', pageTitle: 'Alpha', text: 'A', createdAt: t(3) },
      ],
      'daily',
      'Lab wiki',
    );
    expect(digest?.subject).toBe('Lab wiki: 3 updates on pages you follow');
    expect(digest?.text).toContain('Alpha (a.md)\n- A\n\nBeta (b.md)\n- B1\n- B2');
  });
});

describe('source_check.record permission (D-165)', () => {
  const actor = { kind: 'agent', roles: ['reviewer'], auth: { kind: 'token', scopes: ['review'] } } as const;
  it('needs reviewer + review scope and refuses the section version author', () => {
    expect(can(actor, 'source_check.record', {})).toEqual({ ok: true });
    expect(can(actor, 'source_check.record', { isOwnSectionVersion: true })).toEqual({
      ok: false,
      code: 'SELF_REVIEW',
    });
    expect(
      can({ ...actor, auth: { kind: 'token', scopes: ['read'] } }, 'source_check.record', {}),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
  });
});
