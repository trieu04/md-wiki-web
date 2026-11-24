import { describe, expect, it } from 'vitest';
import {
  coverageRow,
  credibilityTab,
  decisionInput,
  detailModel,
  queueRow,
  reachText,
  sourceRow,
  statTiles,
} from '../src/features/credibility/model';
import { defaultScope, noticeRow } from '../src/features/home/model';
import { notificationRow, unreadLabel } from '../src/features/notifications/model';
import { isFollowing, sectionFor } from '../src/features/page/model';
import { gateInput, gateRow } from '../src/features/settings/model';
import {
  activeUseful,
  canUndo,
  checkInput,
  checkSubmitLabel,
  citedChoices,
  doneModel,
  emptyCheckForm,
  emptyReportForm,
  emptyUseForm,
  evidenceRows,
  feedbackQuestion,
  HIDDEN_COUNTS_TEXT,
  peopleText,
  reportInput,
  trustMode,
  usedInput,
  usefulInput,
  type AttestationDto,
  type AttestationResultDto,
  type PeopleDto,
} from '../src/features/trust/model';
import {
  activityRow,
  activityWhat,
  followRow,
  summaryTiles,
  youTab,
} from '../src/features/you/model';
import {
  visualActivity,
  visualCredibilityPages,
  visualCredibilitySources,
  visualFollows,
  visualGates,
  visualNotices,
  visualNotifications,
  visualQueueItems,
} from '../src/dev/fixtures/credibility';
import { visualPage } from '../src/dev/fixtures/reading';

const ref = { path: 'a.md', anchor: 'intro', sectionHash: 'h'.repeat(64) };
const section = { ...ref, title: 'Intro' };
const now = new Date('2026-11-24T12:00:00Z');

function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`missing item ${String(index)}`);
  return item;
}

const people = (over: Partial<PeopleDto> = {}): PeopleDto => ({
  hidden: false,
  acted: true,
  checked: null,
  used: null,
  useful: null,
  onOldVersion: null,
  purpose: '',
  mine: [],
  ...over,
});

const attestation = (over: Partial<AttestationDto> = {}): AttestationDto => ({
  id: 'a1',
  path: 'a.md',
  pageTitle: 'A',
  anchor: 'intro',
  sectionTitle: 'Intro',
  versionLabel: 'v1',
  kind: 'checked',
  details: {},
  blocking: false,
  note: null,
  state: 'active',
  outcomeReason: null,
  topicId: null,
  createdAt: '2026-11-24T11:55:00Z',
  undoUntil: '2026-11-24T12:05:00Z',
  ...over,
});

describe('F-04 trust drawer model (§7.7.4, §7.7.6)', () => {
  it('falls back to Why for unknown modes', () => {
    expect(trustMode('check')).toBe('check');
    expect(trustMode('nope')).toBe('why');
    expect(trustMode(undefined)).toBe('why');
  });

  it('describes evidence without names, marking old versions as not counting', () => {
    const [row, old] = evidenceRows([
      {
        id: '1',
        kind: 'source_check',
        at: '2026-11-12T00:00:00Z',
        actorKind: 'person',
        summary: 'Checked against Pawley by a person',
        result: 'supported',
        sourceRef: 'doi:10.1/x',
        sourceName: 'Pawley',
        valid: true,
        onOldVersion: false,
        contributes: true,
        open: null,
      },
      {
        id: '2',
        kind: 'report',
        at: '2026-11-10T00:00:00Z',
        actorKind: 'person',
        summary: 'Report: outdated',
        result: null,
        sourceRef: null,
        sourceName: null,
        valid: true,
        onOldVersion: true,
        contributes: false,
        open: true,
      },
    ]);
    expect(row).toMatchObject({
      when: '12 Nov',
      meta: 'Supports the text · counts for this version',
    });
    expect(old?.meta).toBe('open · previous version, does not count now');
  });

  it('hides counts until the reader acts or reveals them (D-168)', () => {
    expect(peopleText(undefined)).toBe(HIDDEN_COUNTS_TEXT);
    expect(peopleText(people({ hidden: true }))).toBe(HIDDEN_COUNTS_TEXT);
    expect(peopleText(people())).toBe('No one has said they rely on it.');
    expect(
      peopleText(
        people({
          checked: {
            people: 2,
            teams: [
              { team: 'A', people: 1 },
              { team: 'B', people: 1 },
            ],
          },
          used: { people: 1, teams: [{ team: 'A', people: 1 }] },
          useful: 1,
        }),
      ),
    ).toBe(
      '2 people in 2 teams checked this version · 1 person in 1 team used it in practice · 1 person found it useful.',
    );
    expect(peopleText(people({ onOldVersion: { checked: 3, used: 0 } }))).toBe(
      '3 checks on the previous version.',
    );
  });

  it('builds a checked attestation from a cited or another source', () => {
    const form = {
      ...emptyCheckForm(['doi:10.1/x']),
      location: ' Table 2.1 ',
      comparedNumbers: true,
    };
    const built = checkInput(form, section, false);
    expect(built).toEqual({
      ok: true,
      input: {
        ...ref,
        sawCounts: false,
        kind: 'checked',
        checked: {
          source: { ref: 'doi:10.1/x', cited: true },
          location: 'Table 2.1',
          result: 'supports',
          comparedNumbers: true,
        },
      },
    });
    const other = checkInput(
      { ...emptyCheckForm([]), otherSource: 'Manual p. 4', location: 'p. 4', note: ' n ' },
      section,
      true,
    );
    expect(other.ok && other.input.checked?.source).toEqual({ ref: 'Manual p. 4', cited: false });
    expect(other.ok && other.input.note).toBe('n');
  });

  it('rejects missing and over-long check fields', () => {
    const built = checkInput({ ...emptyCheckForm([]), location: 'x'.repeat(201) }, section, false);
    expect(built).toEqual({
      ok: false,
      errors: { source: 'Name the source you checked.', location: 'Use at most 200 characters.' },
    });
    const long = checkInput(
      { ...emptyCheckForm([]), otherSource: 'x'.repeat(501), location: '', note: 'x'.repeat(2001) },
      section,
      false,
    );
    expect(long.ok ? null : Object.keys(long.errors)).toEqual(['source', 'location', 'note']);
  });

  it('requires *What did you have to change?* unless it worked as written', () => {
    expect(usedInput(emptyUseForm, section, false)).toMatchObject({
      ok: true,
      input: { kind: 'used', used: { use: 'acquisition', worked: 'yes' } },
    });
    expect(usedInput({ ...emptyUseForm, worked: 'no', change: ' ' }, section, false)).toEqual({
      ok: false,
      errors: { change: 'Say what you had to change.' },
    });
    expect(
      usedInput(
        { ...emptyUseForm, worked: 'with_changes', change: ' pinhole 0.8 AU ' },
        section,
        false,
      ),
    ).toMatchObject({
      ok: true,
      input: { used: { worked: 'with_changes', change: 'pinhole 0.8 AU' } },
    });
  });

  it('builds reports and useful attestations', () => {
    expect(usefulInput(section, true)).toEqual({ ...ref, sawCounts: true, kind: 'useful' });
    expect(reportInput(emptyReportForm('q'), section, false)).toEqual({
      ok: false,
      errors: { suggestion: 'Say what it should say, and how you know.' },
    });
    expect(
      reportInput(
        { ...emptyReportForm(' q '), suggestion: ' 1.44 ', blocking: true },
        section,
        false,
      ),
    ).toEqual({
      ok: true,
      input: {
        ...ref,
        sawCounts: false,
        kind: 'wrong',
        quote: 'q',
        suggestion: '1.44',
        blocking: true,
      },
    });
    expect(
      reportInput(
        { ...emptyReportForm(), suggestion: 's', quote: 'x'.repeat(2001) },
        section,
        false,
      ),
    ).toMatchObject({ ok: false, errors: { quote: 'Use at most 2000 characters.' } });
  });

  it('labels the submit and the after-submit text by result', () => {
    expect(checkSubmitLabel('contradicts')).toBe('Save check and send report');
    expect(checkSubmitLabel('supports')).toBe('Save source check');
    const result = {
      attestation: attestation(),
      report: null,
      people: people(),
      label: { label: 'checked', since: null, reviewerKind: null, reason: null },
      following: true,
    } satisfies AttestationResultDto;
    expect(doneModel('check', result, 'Intro', []).text).toBe(
      'It counts for this version of Intro.',
    );
    expect(
      doneModel('check', { ...result, report: attestation({ kind: 'report' }) }, 'Intro', []).text,
    ).toBe('Because it contradicts the text, the page authors got a report too.');
    expect(doneModel('report', result, 'Intro', ['m.nguyen', 'h.pham']).title).toBe(
      'Report sent to m.nguyen and h.pham',
    );
    expect(doneModel('report', result, 'Intro', []).title).toBe('Report sent to the page authors');
  });

  it('allows undo only within 10 minutes and while it still counts', () => {
    expect(canUndo(attestation(), now)).toBe(true);
    expect(canUndo(attestation(), new Date('2026-11-24T12:05:00Z'))).toBe(false);
    expect(canUndo(attestation({ state: 'withdrawn' }), now)).toBe(false);
    expect(canUndo(attestation({ kind: 'report', state: 'open' }), now)).toBe(true);
    expect(canUndo(attestation({ kind: 'report', state: 'confirmed' }), now)).toBe(false);
  });

  it('finds the viewer’s active Useful', () => {
    const useful = attestation({ kind: 'useful' });
    expect(activeUseful(people({ mine: [attestation(), useful] }))).toBe(useful);
    expect(activeUseful(people({ mine: [{ ...useful, state: 'withdrawn' }] }))).toBeNull();
    expect(activeUseful(undefined)).toBeNull();
  });

  it('offers cited DOIs and links, deduplicated', () => {
    expect(
      citedChoices(
        'See https://doi.org/10.1101/ABC and [x](https://example.org/a#b) and 10.1101/abc.',
      ),
    ).toEqual([
      { value: 'doi:10.1101/abc', label: '10.1101/abc' },
      { value: 'url:https://example.org/a', label: 'https://example.org/a' },
    ]);
  });

  it('answers page feedback', () => {
    expect(feedbackQuestion(null)).toBe('Did this page help with your work?');
    expect(feedbackQuestion('yes')).toBe('Thanks. Counted for your team.');
    expect(feedbackQuestion('no')).toMatch(/^Sorry/u);
  });
});

describe('F-03 follow and section target', () => {
  it('follows the page itself, unmuted', () => {
    expect(isFollowing([{ path: 'a.md', anchor: null, muted: false }], 'a.md')).toBe(true);
    expect(isFollowing([{ path: 'a.md', anchor: null, muted: true }], 'a.md')).toBe(false);
    expect(isFollowing([{ path: 'a.md', anchor: 'x', muted: false }], 'a.md')).toBe(false);
    expect(isFollowing([], 'a.md')).toBe(false);
  });

  it('acts on the hash the reader read', () => {
    expect(sectionFor(visualPage, 'resolution')).toEqual({
      path: visualPage.path,
      anchor: 'resolution',
      sectionHash: '0'.repeat(64),
      title: 'Resolution',
    });
    expect(sectionFor(visualPage, 'missing')).toBeNull();
  });
});

describe('F-05 You (§7.7.9)', () => {
  it('parses the tab', () => {
    expect(youTab('trust')).toBe('trust');
    expect(youTab('x')).toBe('following');
  });

  it('links Check again to the stale section', () => {
    const [first, , third] = visualFollows.items.map((item) => followRow(item, now));
    expect(first).toMatchObject({ action: 'Open', status: '1 section under re-check', detail: '' });
    expect(third).toMatchObject({
      action: 'Check again',
      href: '/wiki/point-spread-function.md#table',
      detail: 'Your old check on NA table stopped counting',
    });
    expect(followRow({ ...at(visualFollows.items, 0), muted: true }, now).status).toBe('Muted');
  });

  it('describes what you did and its outcome', () => {
    const rows = visualActivity.items.map(activityRow);
    expect(rows.map(({ status }) => status)).toEqual([
      'Counting',
      'Stopped counting',
      'Fixed and published',
      'Dismissed',
      'Counting',
    ]);
    expect(rows[1]?.action).toBe('Check again');
    expect(rows[3]).toMatchObject({
      action: 'Reply',
      detail: '“The table is for 20 °C; noted in the text.”',
      href: '/work/discussions?topic=00000000-0000-4000-8000-000000000201',
    });
    expect(activityWhat(attestation({ kind: 'useful' }))).toBe('Marked useful (24 Nov)');
    expect(activityWhat(attestation({ details: { result: 'unverifiable' } }))).toBe(
      'Checked a source: could not check (24 Nov)',
    );
    expect(activityWhat(attestation({ kind: 'report', details: {} }))).toBe(
      'Reported: a problem (24 Nov)',
    );
  });

  it('lists the yearly summary', () => {
    expect(
      summaryTiles({
        year: 2026,
        checksCounting: 9,
        reportsConfirmed: 3,
        suggestionsPublished: 5,
      }).map(({ value }) => value),
    ).toEqual(['9', '3', '5']);
  });
});

describe('F-01 notices and scope', () => {
  it('defaults to Pages you use when signed in', () => {
    expect(defaultScope(true)).toBe('mine');
    expect(defaultScope(false)).toBe('all');
  });

  it('turns notices into rows with an action', () => {
    const [recheck, edited] = visualNotices.items.map(noticeRow);
    expect(recheck).toMatchObject({
      label: 'recheck',
      title: 'Confocal microscopy: a section you use is under re-check',
      action: 'Read the section',
      href: '/wiki/confocal-microscopy.md#principle',
    });
    expect(edited).toMatchObject({ label: 'not_reviewed', action: 'Check again' });
  });
});

describe('F-12 Credibility (§7.7.8)', () => {
  it('parses the tab', () => {
    expect(credibilityTab('sources')).toBe('sources');
    expect(credibilityTab(null)).toBe('queue');
  });

  it('builds tiles with shares of all sections', () => {
    const tiles = statTiles(visualCredibilityPages.tiles);
    expect(tiles.map(({ n }) => n)).toEqual(['427', '479', '31', '1', '104']);
    expect(tiles[0]?.delta).toBe('41% · +6 this week');
    expect(tiles[3]?.delta).toBe('Readers see a warning');
    expect(tiles[4]?.delta).toBe('10%');
    const empty = statTiles({
      checked: { sections: 0, changeThisWeek: 0 },
      reviewed: { sections: 0, changeThisWeek: 0 },
      recheck: { sections: 0, changeThisWeek: 0 },
      error: { sections: 0, changeThisWeek: 0 },
      not_reviewed: { sections: 0, changeThisWeek: -2 },
    });
    expect(empty.map(({ delta }) => delta)).toEqual([
      '0%',
      '0%',
      '0%',
      'None',
      '0% · -2 this week',
    ]);
  });

  it('describes queue items and their reach', () => {
    expect(reachText({ linkedFrom: 1, teams: 0 })).toBe('Linked from 1 page');
    expect(reachText({ linkedFrom: 6, teams: 3 })).toBe('Linked from 6 pages · used by 3 teams');
    const [retraction, report, candidate] = visualQueueItems.map(queueRow);
    expect(retraction).toMatchObject({ where: 'Deconvolution › Richardson–Lucy', ai: false });
    expect(report?.blocking).toBe(true);
    expect(candidate?.ai).toBe(true);
    const fix = detailModel(at(visualQueueItems, 4));
    expect(fix).toMatchObject({ canDecide: false, reviewHref: '/work/proposals' });
    expect(detailModel(at(visualQueueItems, 1)).outcomes.map(({ label }) => label)).toEqual([
      'Confirm',
      'Wrong: mark as confirmed error',
      'Dismiss with a reason',
    ]);
  });

  it('validates a decision: allowed outcome and a trimmed reason', () => {
    const item = { type: 'report' as const, id: 'r1', outcomes: ['confirm', 'dismiss'] };
    expect(decisionInput(item, 'confirm', '  ok ')).toEqual({
      ok: true,
      input: { type: 'report', id: 'r1', outcome: 'confirm', reason: 'ok' },
    });
    expect(decisionInput(item, 'yes', '')).toEqual({
      ok: false,
      errors: {
        outcome: 'Choose what readers should see.',
        reason: 'Give a reason. It is shown in the section’s evidence.',
      },
    });
    expect(decisionInput(item, null, 'x'.repeat(4001))).toMatchObject({
      ok: false,
      errors: { reason: 'Use at most 4000 characters.' },
    });
  });

  it('renders coverage and source rows', () => {
    expect(coverageRow(at(visualCredibilityPages.items, 0))).toMatchObject({
      page: 'Confocal microscopy',
      label: 'recheck',
      ariaLabel:
        '5 sections: 1 checked against source, 2 reviewed, 1 under re-check, 1 not reviewed',
    });
    expect(
      coverageRow({ ...at(visualCredibilityPages.items, 0), oldestUnchecked: null }).oldest,
    ).toBe('None');
    const [retracted, , , changed] = visualCredibilitySources.items.map(sourceRow);
    expect(retracted).toMatchObject({ status: 'Retracted', tone: 'error', tier: 'High' });
    expect(changed).toMatchObject({ status: 'Changed since cited', tier: 'Low' });
    expect(
      sourceRow({ ...at(visualCredibilitySources.items, 0), tier: null, lastCheck: null }),
    ).toMatchObject({
      tier: 'No tier',
      checked: 'Never',
    });
  });
});

describe('F-14 Trust labels gates (§7.7.10)', () => {
  it('needs a run record and a past date to turn on, nothing to turn off', () => {
    const today = new Date('2026-11-24T00:00:00Z');
    expect(gateInput(false, { runRecord: '', runDate: '' }, today)).toEqual({
      ok: true,
      input: { enabled: false },
    });
    expect(gateInput(true, { runRecord: ' ', runDate: '' }, today)).toEqual({
      ok: false,
      errors: {
        runRecord: 'Enter the experiment run record.',
        runDate: 'Enter the experiment result date.',
      },
    });
    expect(gateInput(true, { runRecord: '../x', runDate: '2026-12-01' }, today)).toEqual({
      ok: false,
      errors: { runRecord: 'Not a run record path.', runDate: 'Not a past calendar date.' },
    });
    expect(gateInput(true, { runRecord: ' runs/e8d.json ', runDate: '2026-11-01' }, today)).toEqual(
      {
        ok: true,
        input: { enabled: true, runRecord: 'runs/e8d.json', runDate: '2026-11-01' },
      },
    );
  });

  it('shows the reference and who changed it', () => {
    const gate = at(visualGates.items, 0);
    expect(gateRow(gate)).toMatchObject({
      title: 'Score thresholds move labels',
      reference: 'No experiment run recorded',
      updated: null,
    });
    expect(
      gateRow({
        ...gate,
        reference: { runRecord: 'r.json', runDate: '2026-11-01' },
        updatedAt: '2026-11-02T00:00:00Z',
        updatedBy: { id: 'u', name: 'owner', kind: 'human' },
      }),
    ).toMatchObject({
      reference: 'Run r.json (2026-11-01)',
      updated: 'Changed by owner, 2 Nov',
    });
  });
});

describe('Bell (derived)', () => {
  it('links to the section or the discussion and marks unread', () => {
    const [first] = visualNotifications.items.map((item) => notificationRow(item, now));
    expect(first).toMatchObject({
      kind: 'Under re-check',
      href: '/wiki/confocal-microscopy.md#principle',
      unread: true,
    });
    expect(
      notificationRow(
        { ...at(visualNotifications.items, 0), event: 'mention', data: { topicId: 't 1' } },
        now,
      ).href,
    ).toBe('/work/discussions?topic=t%201');
    expect(
      notificationRow({ ...at(visualNotifications.items, 0), path: null, anchor: null }, now).href,
    ).toBeNull();
    expect(unreadLabel(0)).toBe('All read');
    expect(unreadLabel(2)).toBe('2 unread');
  });
});
