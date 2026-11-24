import { describe, expect, it } from 'vitest';
import { visualRecent } from '../src/dev/fixtures/home-search';
import { visualBlocked, visualConflictProposal } from '../src/dev/fixtures/review';
import {
  CONFLICT_OUTCOME,
  choiceCopy,
  conflictInput,
  conflictPanes,
  conflictSubline,
  startingText,
  startsFrom,
} from '../src/features/conflict/model';
import { recentChange } from '../src/features/home/model';
import {
  BLOCKED_CHOICES,
  auditRows,
  blockedHealth,
  blockedModel,
  resolutionInput,
  type BlockedTargetDto,
} from '../src/features/ops/model';
import { changedOutsideReviewNote } from '../src/features/page/model';
import { hasWorkspace, workNavCounts } from '../src/features/workspace/model';
import { invalidationsFor, parseEvent } from '../src/lib/events';
import { queryKeys } from '../src/lib/query-keys';

function need<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture value missing');
  return value;
}

const conflict = need(visualConflictProposal.conflict);

describe('F-07 conflict', () => {
  it('maps the three choices to the contract outcomes (D-99)', () => {
    expect(CONFLICT_OUTCOME).toEqual({
      merge: 'merge',
      mine: 'use_incoming',
      drop: 'keep_current',
    });
    expect(choiceCopy('drop').submit).toBe('Withdraw with reason');
    expect(choiceCopy('merge').submit).toBe('Submit as new proposal');
  });

  it('requires a reason, sends no replacement for drop and a non-empty one otherwise', () => {
    expect(conflictInput('merge', '  ', 'x')).toMatchObject({ error: { field: 'reason' } });
    expect(conflictInput('drop', ' old reason ', 'ignored')).toEqual({
      input: { outcome: 'keep_current', reason: 'old reason' },
      error: null,
    });
    expect(conflictInput('mine', 'r', '  \n')).toMatchObject({ error: { field: 'text' } });
    expect(conflictInput('merge', 'r', 'text\n')).toEqual({
      input: { outcome: 'merge', reason: 'r', replacement: 'text\n' },
      error: null,
    });
    expect(conflictInput('mine', 'r', 'mine')).toMatchObject({
      input: { outcome: 'use_incoming', replacement: 'mine' },
    });
  });

  it('starts each choice from its text and never merges for the author', () => {
    expect(startingText('mine', conflict)).toBe(conflict.proposedText);
    expect(startingText('drop', conflict)).toBe(conflict.currentText);
    // The shared section heading is not repeated.
    expect(startingText('merge', conflict)).toBe(
      `${conflict.currentText.trimEnd()}\n\n| Detector | QE | Noise |\n| PMT | 20–30% | higher |\n| Hybrid | 40–45% | lower |`,
    );
    expect(startingText('merge', { ...conflict, proposedText: 'other\n' })).toBe(
      `${conflict.currentText.trimEnd()}\n\nother`,
    );
    expect(startingText('merge', { ...conflict, currentText: '' })).toBe(
      conflict.proposedText.trimEnd(),
    );
    expect(startsFrom('drop', conflict)).toBe('20261123-2');
    expect(startsFrom('drop', { ...conflict, current: null })).toBe('current page');
  });

  it('marks removed, changed-since and added lines as drawn in F-07', () => {
    const [read, since, mine] = conflictPanes(visualConflictProposal, conflict);
    expect(read?.meta).toBe('20261120-1');
    // The sample proposal also drops the PMT sentence, so it is marked removed too.
    expect(read?.lines.map(({ tone }) => tone)).toEqual(['plain', 'del', 'del', 'del']);
    expect(since?.meta).toBe('20261123-2 · lightsheet-lead-2');
    expect(since?.lines.map(({ tone }) => tone)).toEqual([
      'plain',
      'plain',
      'theirs',
      'theirs',
      'theirs',
    ]);
    expect(mine?.meta).toBe('detector-table');
    expect(mine?.lines.map(({ tone }) => tone)).toEqual(['plain', 'add', 'add', 'add']);
  });

  it('describes the versions, also for a create and an out-of-band edit', () => {
    expect(conflictSubline(conflict)).toBe(
      'You read 20261120-1 · now 20261123-2 (lightsheet-lead-2) · section #detectors',
    );
    expect(
      conflictSubline({
        ...conflict,
        base: null,
        section: null,
        current: { versionLabel: '1', sha256: 'x', publishedBy: null },
      }),
    ).toBe('You proposed a new page · now 1 (changed outside review) · whole page');
    expect(
      conflictPanes(visualConflictProposal, {
        ...conflict,
        current: { versionLabel: '1', sha256: 'x', publishedBy: null },
      })[1]?.meta,
    ).toBe('1 · changed outside review');
  });
});

describe('F-13 blocked targets', () => {
  const target = need(visualBlocked.items[0]);
  it('prints the drawn hash line and the source of the block', () => {
    expect(blockedModel(target)).toMatchObject({
      where: 'deconv-iterations → deconvolution.md · since 09:31',
      hashes: 'File hash on disk 7b21e0c4 · expected new 7b21e0c4 · old 3f90aa12',
      waiting: null,
    });
    const odd: BlockedTargetDto = {
      ...target,
      disk: null,
      old: { sha256: null },
      waiting: ['b', 'c'],
    };
    expect(blockedModel(odd)).toMatchObject({
      hashes: 'File could not be read · expected new 7b21e0c4 · old none',
      waiting: 'Waiting behind it: b, c',
    });
    expect(blockedModel({ ...target, disk: { sha256: null, matches: 'missing' } }).hashes).toMatch(
      /^File missing on disk/u,
    );
  });

  it('maps the three buttons to written / not_written / not_written (D-80)', () => {
    expect(BLOCKED_CHOICES.map(({ outcome }) => outcome)).toEqual([
      'written',
      'not_written',
      'not_written',
    ]);
    expect(resolutionInput('new', ' checked the bytes ')).toEqual({
      input: { outcome: 'written', evidence: 'checked the bytes' },
      error: null,
    });
    expect(resolutionInput('neither', 'x').input?.outcome).toBe('not_written');
    expect(resolutionInput('old', '   ').error).toBe('Say what you checked on disk.');
    expect(resolutionInput('old', 'x'.repeat(4001)).error).toMatch(/4000/u);
    expect(resolutionInput('old', 'x'.repeat(4000)).error).toBeNull();
  });

  it('summarizes the health card', () => {
    expect(blockedHealth([])).toEqual({ value: '0', note: 'None', tone: 'published' });
    expect(blockedHealth([target, { ...target, publicationId: 'p2' }])).toEqual({
      value: '2',
      note: 'deconvolution.md',
      tone: 'error',
    });
  });

  it('names system actors with the decision for auto-publish', () => {
    const rows = auditRows([
      {
        items: [
          {
            id: '1',
            at: '2026-11-23T09:31:00Z',
            action: 'proposal.published',
            actorKind: 'system',
            actor: null,
            subjectType: 'proposal',
            subjectId: '0123456789abcdef',
            data: { decisionId: 'abcdef0123456789' },
          },
          {
            id: '2',
            at: '2026-11-23T09:30:00Z',
            action: 'admin.reindex',
            actorKind: 'system',
            actor: null,
            subjectType: 'wiki',
            subjectId: 'root',
            data: {},
          },
        ],
        nextCursor: null,
      },
    ]);
    expect(rows.map(({ actor, subject, details }) => [actor, subject, details])).toEqual([
      [
        'system (auto-publish after abcdef01)',
        'proposal 01234567',
        '{"decisionId":"abcdef0123456789"}',
      ],
      ['system', 'wiki root', ''],
    ]);
  });
});

describe('Home recent changes and F-03 changed outside review', () => {
  const item = need(visualRecent.items[0]);
  it('shows the section and summary of a reviewed version', () => {
    expect(recentChange(item)).toEqual({
      section: 'NA table',
      change: 'Corrected the 1.4 NA oil value',
    });
    expect(recentChange({ ...item, sectionTitle: null })).toMatchObject({ section: 'Whole page' });
    expect(recentChange({ ...item, summary: null })).toMatchObject({ change: '' });
  });
  it('says when a version was changed outside review', () => {
    const outside = { ...item, proposalSlug: null, sectionTitle: null, summary: null };
    expect(recentChange({ ...outside, changedOutsideReview: true })).toEqual({
      section: '',
      change: 'Changed outside review',
    });
    expect(recentChange(outside)).toEqual({ section: '', change: '' });
    expect(changedOutsideReviewNote({ changedOutsideReview: false })).toBeNull();
    expect(changedOutsideReviewNote({ changedOutsideReview: true })?.title).toBe(
      'Changed outside review',
    );
  });
});

describe('workspace shell', () => {
  it('shows Workspace to roles ≥ reviewer only (D-95)', () => {
    expect(hasWorkspace(undefined)).toBe(false);
    expect(hasWorkspace(['reader', 'contributor'])).toBe(false);
    for (const role of ['reviewer', 'publisher', 'owner'] as const)
      expect(hasWorkspace([role])).toBe(true);
  });
  it('counts open proposals, and blocked targets for owners', () => {
    const counts = { open: 4, stale: 1, blocked: 2, published: 0, rejected: 0, all: 7 };
    expect(workNavCounts(undefined, ['owner'])).toBeUndefined();
    expect(workNavCounts(counts, ['reviewer'])).toEqual({ proposals: 4 });
    expect(workNavCounts(counts, ['owner'])).toEqual({ proposals: 4, ops: 2 });
  });
});

describe('SSE invalidation (D-96)', () => {
  it('maps each event to the query keys of §7.4.11', () => {
    expect(invalidationsFor({ type: 'proposal.changed', slug: 's' })).toEqual([
      ['proposals'],
      queryKeys.proposal('s'),
      queryKeys.escalation('s'),
      queryKeys.suggestions,
      ['inbox'],
    ]);
    expect(invalidationsFor({ type: 'publication.changed', slug: 's', phase: 'unknown' })).toEqual([
      queryKeys.proposal('s'),
      queryKeys.escalation('s'),
      ['proposals'],
      queryKeys.opsBlocked,
      ['inbox'],
    ]);
    expect(invalidationsFor({ type: 'inbox.changed' })).toEqual([['inbox'], ['escalation']]);
    expect(invalidationsFor({ type: 'page.changed', path: 'a.md' })).toEqual([
      queryKeys.page('a.md'),
      queryKeys.history('a.md'),
      ['why', 'a.md'],
      ['people', 'a.md'],
      ['wiki.tree'],
      ['wiki.recent'],
      ['search'],
      // Phase 9 (§7.7.13): credibility views and the viewer's notices.
      ['credibility'],
      ['me.notices'],
      ['me.follows'],
      ['me.activity'],
      queryKeys.notifications,
    ]);
    expect(invalidationsFor({ type: 'proposal.changed' })).toEqual([
      ['proposals'],
      queryKeys.suggestions,
      ['inbox'],
    ]);
    expect(invalidationsFor({ type: 'ping' })).toEqual([]);
    expect(invalidationsFor(null)).toEqual([]);
  });
  it('ignores malformed event data', () => {
    expect(parseEvent('{"type":"ping","at":"x"}')).toEqual({ type: 'ping', at: 'x' });
    for (const data of ['not json', '42', 'null', undefined]) expect(parseEvent(data)).toBeNull();
  });
});
