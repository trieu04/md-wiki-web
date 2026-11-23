import { describe, expect, it } from 'vitest';
import {
  computeSectionLabel,
  LABEL_ORDER,
  matchesLabelSelection,
  pageLabel,
  type Label,
  type LabelDto,
  type SectionLabelInput,
} from '../src/index.js';

const currentHash = 'a'.repeat(64);
const oldHash = 'b'.repeat(64);
const early = '2026-01-01T12:00:00Z';
const late = '2026-01-01T12:00:00.000001Z';
const low = '019b796d-d600-7000-8000-000000000001';
const high = '019b796d-d600-7000-8000-000000000002';
const person = { id: low, sectionHash: currentHash, time: early, kind: 'person' } as const;
const agent = { ...person, kind: 'agent' } as const;
const issue = { ...agent, reason: 'source retracted' };
const check = { ...person, checkerKind: 'person', valid: true, result: 'supported' } as const;
const confirmation = { ...person, valid: true };
const empty: SectionLabelInput = {
  currentHash,
  confirmedErrors: [],
  openRecheckReasons: [],
  reviewedVersions: [],
  sourceChecks: [],
  ownerConfirmations: [],
};
const reviewed = { ...empty, reviewedVersions: [agent] };
const all = {
  ...reviewed,
  confirmedErrors: [{ ...issue, reason: 'confirmed error' }],
  openRecheckReasons: [issue],
  sourceChecks: [check],
  ownerConfirmations: [confirmation],
};
const dto = (
  label: Label,
  since: string | null = null,
  reviewerKind: LabelDto['reviewerKind'] = null,
  reason: string | null = null,
): LabelDto => ({ label, since, reviewerKind, reason });

describe('section precedence', () => {
  it('1: an uncorrected error overrides all other evidence', () => {
    expect(computeSectionLabel(all)).toEqual(dto('error', early, null, 'confirmed error'));
  });
  it('2: recheck overrides both reviewed and unreviewed states', () => {
    for (const base of [empty, all])
      expect(
        computeSectionLabel({ ...base, confirmedErrors: [], openRecheckReasons: [issue] }),
      ).toEqual(dto('recheck', early, null, issue.reason));
  });
  it('3: source evidence cannot substitute for a published review', () => {
    expect(
      computeSectionLabel({ ...empty, sourceChecks: [check], ownerConfirmations: [confirmation] }),
    ).toEqual(dto('not_reviewed'));
  });
  it('4: a passed person check or a valid owner confirmation suffices', () => {
    expect(computeSectionLabel({ ...reviewed, sourceChecks: [check] })).toEqual(
      dto('checked', early, 'person'),
    );
    expect(computeSectionLabel({ ...reviewed, ownerConfirmations: [confirmation] })).toEqual(
      dto('checked', early, 'person'),
    );
  });
  it('5: reviewed, with the reason on the review when the source was not checkable', () => {
    expect(
      computeSectionLabel({
        ...reviewed,
        reviewedVersions: [{ ...agent, reason: 'source not checkable' }],
      }),
    ).toEqual(dto('reviewed', early, 'agent', 'source not checkable'));
  });
  it('an agent source check alone cannot promote reviewed to checked', () => {
    expect(
      computeSectionLabel({ ...reviewed, sourceChecks: [{ ...check, checkerKind: 'agent' }] }),
    ).toEqual(dto('reviewed', early, 'agent'));
  });
  it('invalid or non-passing evidence is not a qualifying check', () => {
    expect(
      computeSectionLabel({
        ...reviewed,
        sourceChecks: [
          { ...check, valid: false },
          { ...check, result: 'not_supported' },
          { ...check, result: 'unverifiable' },
        ],
        ownerConfirmations: [{ ...confirmation, valid: false }],
      }),
    ).toEqual(dto('reviewed', early, 'agent'));
  });
  it('ignores every evidence type on another hash (even a formerly reviewed version)', () => {
    expect(computeSectionLabel({ ...all, currentHash: oldHash })).toEqual(dto('not_reviewed'));
    expect(
      computeSectionLabel({
        ...all,
        currentHash: oldHash,
        reviewedVersions: [{ ...agent, sectionHash: oldHash }],
      }),
    ).toEqual(dto('reviewed', early, 'agent'));
  });
});

describe('D-34 winning record selection, independent of input order', () => {
  it.each([
    ['confirmedErrors', 'error'],
    ['openRecheckReasons', 'recheck'],
  ] as const)('%s: earliest, then person, then lower id', (key, label) => {
    const records = [
      { ...issue, time: late, reason: 'later' },
      { ...issue, kind: 'agent' as const, reason: 'agent' },
      { ...issue, kind: 'person' as const, id: high, reason: 'higher id' },
      { ...issue, kind: 'person' as const, reason: 'winner' },
    ];
    for (const order of [records, [...records].reverse()]) {
      expect(computeSectionLabel({ ...empty, [key]: order })).toEqual(
        dto(label, early, null, 'winner'),
      );
    }
  });
  it.each([
    ['confirmedErrors', 'error'],
    ['openRecheckReasons', 'recheck'],
  ] as const)('%s: time decides before reviewer kind and id', (key, label) => {
    // The later record would win on both tie-breakers (person, lower id); only time must decide.
    const records = [
      { ...issue, kind: 'person' as const, id: low, time: late, reason: 'later person' },
      { ...issue, kind: 'agent' as const, id: high, time: early, reason: 'earlier agent' },
    ];
    for (const order of [records, [...records].reverse()]) {
      expect(computeSectionLabel({ ...empty, [key]: order })).toEqual(
        dto(label, early, null, 'earlier agent'),
      );
    }
  });
  // Same instant, different allowed serializations: `since` reveals which id won even on rule 4.
  const sameLate = '2026-01-01T12:00:00.0000010Z';
  it('checked: latest across both evidence lists, then person, then lower id', () => {
    const sourceChecks = [{ ...check, id: high, time: late }];
    expect(
      computeSectionLabel({ ...reviewed, sourceChecks, ownerConfirmations: [confirmation] }),
    ).toEqual(dto('checked', late, 'person'));
    expect(
      computeSectionLabel({
        ...reviewed,
        sourceChecks: [check],
        ownerConfirmations: [{ ...confirmation, time: late }],
      }),
    ).toEqual(dto('checked', late, 'person'));
    expect(
      computeSectionLabel({
        ...reviewed,
        sourceChecks,
        ownerConfirmations: [{ ...agent, valid: true, time: sameLate }],
      }),
    ).toEqual(dto('checked', late, 'person'));
    expect(
      computeSectionLabel({
        ...reviewed,
        sourceChecks,
        ownerConfirmations: [{ ...confirmation, time: sameLate }],
      }),
    ).toEqual(dto('checked', sameLate, 'person'));
  });
  it('reviewed: newest first, then person, then lower id', () => {
    const newest = { ...agent, time: late };
    expect(computeSectionLabel({ ...empty, reviewedVersions: [newest, person] })).toEqual(
      dto('reviewed', late, 'agent'),
    );
    const records = [newest, { ...person, id: high, time: late }, { ...person, time: sameLate }];
    for (const order of [records, [...records].reverse()]) {
      expect(computeSectionLabel({ ...empty, reviewedVersions: order })).toEqual(
        dto('reviewed', sameLate, 'person'),
      );
    }
  });
});

it('adding a recheck never improves trust, for every absent/current/stale combination of evidence', () => {
  const trust: Record<Label, number> = {
    error: 0,
    recheck: 1,
    not_reviewed: 2,
    reviewed: 3,
    checked: 4,
  };
  function variants<T extends { sectionHash: string }>(record: T): T[][] {
    return [[], [record], [{ ...record, sectionHash: oldHash }]];
  }
  for (const confirmedErrors of variants(issue))
    for (const openRecheckReasons of variants(issue))
      for (const reviewedVersions of variants(agent))
        for (const sourceChecks of variants(check))
          for (const ownerConfirmations of variants(confirmation)) {
            const input = {
              currentHash,
              confirmedErrors,
              openRecheckReasons,
              reviewedVersions,
              sourceChecks,
              ownerConfirmations,
            };
            const before = computeSectionLabel(input);
            for (const sectionHash of [currentHash, oldHash]) {
              const after = computeSectionLabel({
                ...input,
                openRecheckReasons: [...openRecheckReasons, { ...issue, sectionHash }],
              });
              expect(trust[after.label]).toBeLessThanOrEqual(trust[before.label]);
            }
          }
});

describe('search label selection', () => {
  it('passes every label when the selection is empty', () => {
    const selected = new Set<Label>();
    expect(LABEL_ORDER.filter((label) => matchesLabelSelection(label, selected))).toEqual(
      LABEL_ORDER,
    );
  });

  it('passes only selected labels and recheck, even when recheck is not selected', () => {
    const selected = new Set<Label>(['checked', 'reviewed']);
    expect(LABEL_ORDER.filter((label) => matchesLabelSelection(label, selected))).toEqual([
      'checked',
      'reviewed',
      'recheck',
    ]);
  });

  it('passes every label when all labels are selected', () => {
    const selected = new Set(LABEL_ORDER);
    expect(LABEL_ORDER.filter((label) => matchesLabelSelection(label, selected))).toEqual(
      LABEL_ORDER,
    );
  });
});

it('page label counts each section and takes the worst present, including the empty-page case', () => {
  const spread = { checked: 0, reviewed: 0, not_reviewed: 0, recheck: 0, error: 0 };
  const sections: LabelDto[] = [];
  expect(pageLabel(sections)).toEqual({ label: 'not_reviewed', spread });
  for (const label of ['checked', 'reviewed', 'not_reviewed', 'recheck', 'error'] as const) {
    sections.unshift(dto(label));
    sections.push(dto('checked'));
    spread[label]++;
    spread.checked++;
    expect(pageLabel(sections)).toEqual({ label, spread });
  }
});
