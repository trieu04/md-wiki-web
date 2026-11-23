import { describe, expect, it } from 'vitest';
import { visualProposal, visualProposalItems, visualDiff } from '../src/dev/fixtures/review';
import {
  age,
  bindingText,
  decisionPanel,
  detailStatusInput,
  filterRows,
  historyRows,
  proposalRow,
  proposalStatus,
  proposalTab,
  proposalTabs,
  proposalWith,
  publishSteps,
  readerBody,
  refRows,
  reviewBanner,
  reviewDiff,
  type ProposalDetailDto,
  type ProposalDiffDto,
  type ProposalListItemDto,
} from '../src/features/review/model';

function need<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture value missing');
  return value;
}

const now = new Date('2026-11-23T12:00:00Z');
const item = (overrides: Partial<ProposalListItemDto> = {}): ProposalListItemDto => {
  const first = visualProposalItems[0];
  if (!first) throw new Error('fixture');
  return { ...first, ...overrides };
};

describe('F-09 tabs', () => {
  it('accepts only the six tabs and defaults to open', () => {
    expect(proposalTab('blocked')).toBe('blocked');
    for (const value of [undefined, '', 'OPEN', 'escalated', 1])
      expect(proposalTab(value)).toBe('open');
  });
  it('labels tabs with counts in the frame order, without counts before data', () => {
    expect(
      proposalTabs({ open: 4, stale: 1, blocked: 1, published: 51, rejected: 7, all: 64 }).map(
        ({ label, count }) => `${label} ${String(count)}`,
      ),
    ).toEqual(['Open 4', 'Stale 1', 'Blocked 1', 'Published 51', 'Rejected 7', 'All 64']);
    expect(proposalTabs(undefined).every((tab) => !('count' in tab))).toBe(true);
  });
});

describe('age', () => {
  it.each([
    ['2026-11-23T11:48:00Z', '12 min'],
    ['2026-11-23T12:00:30Z', '0 min'], // clock skew never goes negative
    ['2026-11-23T10:00:00Z', '2 h'],
    ['2026-11-22T12:00:00Z', '1 d'],
  ])('%s → %s', (at, expected) => {
    expect(age(at, now)).toBe(expected);
  });
});

describe('proposalStatus', () => {
  const base = { conflict: false, withdrawn: false, updatedAt: '2026-11-23T09:31:00Z' };
  it.each([
    [
      { state: 'pending', tab: 'open', phase: null },
      'pending',
      'Pending',
      'Waiting for a decision',
    ],
    [
      { state: 'pending', tab: 'open', phase: null, conflict: true },
      'pending',
      'Pending',
      'Page changed after the author read it',
    ],
    [
      { state: 'approved', tab: 'open', phase: 'writing' },
      'publishing',
      'Approved · publishing',
      'Publishing now',
    ],
    [
      { state: 'approved', tab: 'open', phase: null },
      'publishing',
      'Approved',
      'Waiting to be published',
    ],
    [
      { state: 'approved', tab: 'open', phase: 'not_written' },
      'publishing',
      'Approved',
      'Waiting to publish again',
    ],
    [
      { state: 'approved', tab: 'blocked', phase: 'unknown' },
      'error',
      'Blocked',
      'Publish outcome unknown since 09:31',
    ],
    [
      { state: 'stale', tab: 'stale', phase: 'stale' },
      'error',
      'Stale',
      'Page changed after the author read it',
    ],
    [
      {
        state: 'published',
        tab: 'published',
        phase: 'done',
        publishedVersion: '20261123-1',
        autoPublished: true,
      },
      'published',
      'Published',
      'Automatically · 20261123-1',
    ],
    [
      {
        state: 'published',
        tab: 'published',
        phase: 'done',
        publishedVersion: '20261123-1',
        autoPublished: false,
      },
      'published',
      'Published',
      '20261123-1',
    ],
    [
      { state: 'rejected', tab: 'rejected', phase: null },
      'closed',
      'Rejected',
      'Sent back with a reason',
    ],
    [
      { state: 'rejected', tab: 'rejected', phase: null, withdrawn: true },
      'closed',
      'Withdrawn',
      'Withdrawn by the author',
    ],
  ] as const)('%j', (input, tone, status, detail) => {
    expect(proposalStatus({ ...base, ...input })).toEqual({ tone, status, detail });
  });
});

describe('proposalWith and rows', () => {
  it('names who has the proposal now', () => {
    expect(proposalWith(item({ state: 'pending', tab: 'open', assignees: [] }))).toBe('Nobody yet');
    expect(
      proposalWith(
        item({
          state: 'pending',
          tab: 'open',
          assignees: [
            { id: 'a', name: 'm.nguyen', kind: 'human' },
            { id: 'b', name: 'h.pham', kind: 'human' },
          ],
        }),
      ),
    ).toBe('m.nguyen, h.pham');
    expect(proposalWith(item({ state: 'stale', tab: 'stale' }))).toBe('lab-agent (resubmit)');
    expect(proposalWith(item({ state: 'approved', tab: 'blocked' }))).toBe('Owner (investigate)');
    expect(
      proposalWith(
        item({
          state: 'published',
          tab: 'published',
          decision: {
            approve: true,
            at: now.toISOString(),
            reviewerKind: 'agent',
            reviewer: { id: 'r', name: 'reviewer-agent', kind: 'agent' },
          },
        }),
      ),
    ).toBe('Decided by reviewer-agent');
    expect(proposalWith(item({ state: 'rejected', tab: 'rejected', decision: null }))).toBe('—');
  });

  it('shows page#section and filters by id, title, page or author (case-insensitive)', () => {
    const rows = visualProposalItems.map((row) => proposalRow(row, now));
    expect(rows[0]).toMatchObject({
      slug: 'fix-pinhole-units',
      where: 'confocal-microscopy.md#principle',
      href: '/work/proposals/fix-pinhole-units',
      kind: 'agent',
      age: '2 h',
    });
    expect(filterRows(rows, '  ').length).toBe(rows.length);
    expect(filterRows(rows, 'DECONV').map((row) => row.slug)).toEqual(['deconv-iterations']);
    expect(filterRows(rows, 'a.tran').map((row) => row.slug)).toEqual([
      'new-sted-page',
      'sted-wavelength',
    ]);
    expect(filterRows(rows, 'nothing-matches')).toEqual([]);
  });

  it('encodes slugs in review links', () => {
    expect(proposalRow(item({ slug: 'a b/c' }), now).href).toBe('/work/proposals/a%20b%2Fc');
  });
});

describe('F-10 Changes', () => {
  it('keeps two context lines and collapses longer unchanged runs', () => {
    const diff = reviewDiff(visualDiff(), 'Principle');
    expect(diff.heading).toBe('Section Principle · 2 lines added, 1 line removed');
    expect(diff.rows.map(({ kind, number }) => `${kind}:${String(number)}`)).toEqual([
      'same:12',
      'same:13',
      'del:14',
      'add:14',
      'same:15',
      'same:16',
      'gap:null',
      'same:37',
      'same:38',
      'add:41',
    ]);
    expect(diff.rows[6]?.text).toBe('20 unchanged lines');
  });

  it('collapses a leading run and drops an all-unchanged diff', () => {
    const lines = Array.from({ length: 5 }, (_, i) => ({
      kind: 'same' as const,
      oldLine: i + 1,
      newLine: i + 1,
      text: `l${String(i)}`,
    }));
    const unchanged: ProposalDiffDto = { ...visualDiff(), lines, stats: { added: 0, removed: 0 } };
    expect(reviewDiff(unchanged, null)).toEqual({ heading: 'Whole page · no changes', rows: [] });
    const tail = reviewDiff(
      {
        ...unchanged,
        lines: [...lines, { kind: 'add', oldLine: null, newLine: 6, text: 'new' }],
        stats: { added: 1, removed: 0 },
      },
      null,
      1,
    );
    expect(tail.rows.map(({ kind, text }) => `${kind}:${text}`)).toEqual([
      'gap:4 unchanged lines',
      'same:l4',
      'add:new',
    ]);
    expect(tail.heading).toBe('Whole page · 1 line added');
  });
});

describe('publish progress', () => {
  it.each([
    ['prepared', ['done', 'current', 'todo', 'todo']],
    ['writing', ['done', 'current', 'todo', 'todo']],
    ['unknown', ['done', 'current', 'todo', 'todo']],
    ['written', ['done', 'done', 'done', 'current']],
    ['done', ['done', 'done', 'done', 'done']],
  ] as const)('%s', (phase, states) => {
    expect(publishSteps(phase)?.map(({ state }) => state)).toEqual(states);
  });
  it.each([null, 'stale', 'not_written'] as const)('no progress for %s', (phase) => {
    expect(publishSteps(phase)).toBeNull();
  });
});

const pending = visualProposal('fix-pinhole-units', null);
const blocked = visualProposal('deconv-iterations', null);
const publishing = visualProposal('fix-pinhole-units', 'publishing');

describe('decision panel', () => {
  it('lets the assignee decide and explains why others cannot', () => {
    expect(decisionPanel(pending, 'x')).toEqual({ kind: 'decide' });
    const notMine = { ...pending, can: { ...pending.can, decide: false } };
    expect(decisionPanel(notMine, pending.submitter.id)).toEqual({
      kind: 'note',
      text: 'You proposed this change. Someone else decides.',
    });
    expect(decisionPanel(notMine, 'someone')).toMatchObject({
      text: 'Assigned to m.nguyen. You are not assigned to this proposal.',
    });
    expect(decisionPanel({ ...notMine, assignment: null }, 'someone')).toMatchObject({
      text: 'Nobody is assigned yet. You are not assigned to this proposal.',
    });
  });

  it('shows progress while publishing and when blocked (as drawn)', () => {
    expect(decisionPanel(publishing, null)).toMatchObject({
      kind: 'publishing',
      text: 'Approved by m.nguyen at 10:44. Publishing automatically if the page is still at 20261120-1.',
    });
    expect(decisionPanel(blocked, null)).toMatchObject({ kind: 'publishing' });
  });

  it('offers manual publish only through can.publish', () => {
    const approved: ProposalDetailDto = {
      ...publishing,
      publication: null,
      can: { ...publishing.can, publish: true },
    };
    expect(decisionPanel(approved, null)).toEqual({
      kind: 'note',
      text: 'Approved by m.nguyen at 10:44. Waiting to be published.',
      publish: true,
    });
    const retry = {
      ...approved,
      publication: { ...need(blocked.publication), phase: 'not_written' as const },
    };
    expect(decisionPanel(retry, null)).toMatchObject({
      text: expect.stringContaining('nothing was written') as string,
    });
  });

  it('explains stale, withdrawn and rejected proposals', () => {
    expect(decisionPanel({ ...pending, state: 'stale', preview: null }, null)).toMatchObject({
      text: 'Not published: the page changed after the author read it.',
    });
    expect(
      decisionPanel(
        {
          ...pending,
          state: 'rejected',
          withdrawn: { reason: 'withdrawn', at: now.toISOString() },
        },
        null,
      ),
    ).toEqual({ kind: 'note', text: 'Withdrawn: withdrawn' });
    const rejected = {
      ...pending,
      state: 'rejected' as const,
      decisions: [{ ...need(publishing.decisions[0]), approve: false, reason: 'Too vague.' }],
    };
    expect(decisionPanel(rejected, null)).toMatchObject({
      text: 'Sent back by m.nguyen at 10:44. Too vague.',
    });
  });
});

describe('review banner', () => {
  it('locks on a changed discussion or binding, keeping the reason', () => {
    expect(reviewBanner(pending, 'DISCUSSION_CHANGED', '/wiki/x')).toMatchObject({
      tone: 'error',
      title: 'New discussion entry.',
      text: 'Reread before deciding. Your reason is kept.',
      action: { label: 'Reload', reload: true },
    });
    expect(reviewBanner(pending, 'DECISION_BINDING_MISMATCH', '/wiki/x')?.title).toBe(
      'The proposal changed.',
    );
  });
  it('shows the publishing, blocked and published banners', () => {
    expect(reviewBanner(publishing, null, '/wiki/x')).toMatchObject({
      title: 'Publishing automatically.',
      action: { href: '/wiki/x' },
    });
    expect(reviewBanner(blocked, null, '/wiki/x')).toMatchObject({
      title: 'Publish outcome unknown.',
      action: { href: '/work/ops' },
    });
    const published = {
      ...publishing,
      state: 'published' as const,
      publication: {
        ...need(publishing.publication),
        phase: 'done' as const,
        versionLabel: '20261123-3',
      },
    };
    expect(reviewBanner(published, null, '/wiki/x')?.text).toBe(
      'Version 20261123-3 is on the page.',
    );
    expect(reviewBanner(pending, null, '/wiki/x')).toBeNull();
  });
});

describe('details', () => {
  it('prints the binding with short hashes and both versions', () => {
    expect(bindingText(need(pending.preview).binding)).toBe(
      'Bound to bundle a1f3c9e2 · artifact 9c0e57b1 · preview 10:31 · discussion v1 · dispute v0',
    );
  });
  it('labels refs and their freshness', () => {
    expect(
      refRows([
        ...pending.refs,
        {
          role: 'scope',
          path: 'b.md',
          versionLabel: null,
          sha256: null,
          currentVersionLabel: '2',
          current: false,
        },
      ]),
    ).toEqual([
      {
        key: 'target:confocal-microscopy.md',
        path: 'confocal-microscopy.md (target)',
        version: '20261120-1',
        now: 'Current',
      },
      {
        key: 'source:sources/pawley-handbook.md',
        path: 'sources/pawley-handbook.md',
        version: '20261118-1',
        now: 'Current',
      },
      { key: 'scope:b.md', path: 'b.md (scope)', version: 'absent', now: 'Changed · now 2' },
    ]);
  });
  it('describes history events and keeps unknown actions by name', () => {
    const at = '2026-11-23T10:09:00Z';
    const event = (action: string, data: Record<string, unknown> = {}) => ({
      id: action,
      at,
      action,
      actor: { id: 'u', name: 'm.nguyen', kind: 'human' as const },
      data,
    });
    expect(
      historyRows([
        event('proposal.decided', { approve: true }),
        event('proposal.published', { versionLabel: '20261123-3', auto: true }),
        event('publication.resolved', { outcome: 'not_written' }),
        { ...event('publication.unknown'), actor: null },
        event('quality.finished'),
      ]).map(({ time, text }) => `${time} ${text}`),
    ).toEqual([
      '10:09 Approved by m.nguyen',
      '10:09 Published as 20261123-3 automatically',
      '10:09 Owner recorded nothing written',
      '10:09 Publish outcome unknown; the page is blocked',
      '10:09 quality.finished',
    ]);
  });
  it('strips the status block for the Final page tab', () => {
    expect(readerBody(need(pending.preview).artifact)).not.toContain('md-wiki:status');
    expect(readerBody('# Plain')).toBe('# Plain');
  });
  it('derives the header status from the latest publication', () => {
    expect(proposalStatus(detailStatusInput(blocked)).status).toBe('Blocked');
  });
});
