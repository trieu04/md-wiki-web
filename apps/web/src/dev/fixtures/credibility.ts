import type { components } from '@md-wiki/contracts';
import { frameSamples } from './samples';
import { visualPage } from './reading';

type S = components['schemas'];
type Label = S['LabelDto']['label'];

const at = '2026-11-23T00:00:00Z';
const labelOf = (k: string): Label =>
  k === 'none' ? 'not_reviewed' : (k as Exclude<Label, 'not_reviewed'>);
const LABEL_BY_TEXT: Record<string, Label> = {
  'Checked against source': 'checked',
  Reviewed: 'reviewed',
  'Not reviewed': 'not_reviewed',
  'Under re-check': 'recheck',
  'Confirmed error': 'error',
};
const labelOfT = (t: { label: string }): Label => LABEL_BY_TEXT[t.label] ?? 'not_reviewed';

/** F-03 rail / F-04 *Why this label* from the frame's per-section evidence. */
export function visualWhy(anchor: string): S['WhyDto'] | null {
  const section = frameSamples.Page.data.find(({ id }) => id === anchor);
  const page = visualPage.sections.find((item) => item.anchor === anchor);
  if (!section || !page) return null;
  return {
    path: visualPage.path,
    anchor,
    title: section.title,
    versionLabel: visualPage.versionLabel,
    sectionHash: page.hash,
    label: page.label,
    meaning:
      anchor === 'resolution'
        ? 'A person compared this exact version with its source and recorded that it matches. That is the highest label a section can have.'
        : 'Labels follow fixed rules over the records below.',
    evidence: section.evidence.map(({ what, meta }, index) => ({
      id: `${anchor}-${String(index)}`,
      kind: what.startsWith('Checked')
        ? 'source_check'
        : what.startsWith('Report')
          ? 'report'
          : 'review',
      at,
      actorKind: what.includes('agent') ? 'agent' : 'person',
      summary: what,
      result: what.startsWith('Checked') ? 'supported' : null,
      sourceRef: null,
      sourceName: meta,
      valid: true,
      onOldVersion: meta.includes('previous version'),
      contributes: !meta.includes('previous version'),
      open: what.startsWith('Report') ? false : null,
    })),
    changeIt: [section.changes],
    note: 'Labels follow fixed rules over these records; they are not a score.',
    baseRateCalibrated: false,
    can: { recordSourceCheck: true, confirm: false, attest: true, report: true },
  };
}

export function visualPeople(reveal: boolean): S['PeopleDto'] {
  const hidden = !reveal;
  return {
    hidden,
    acted: false,
    checked: hidden
      ? null
      : {
          people: 2,
          teams: [
            { team: 'Imaging core', people: 1 },
            { team: 'Light-sheet', people: 1 },
          ],
        },
    used: hidden ? null : { people: 1, teams: [{ team: 'Cell biology', people: 1 }] },
    useful: hidden ? null : 0,
    onOldVersion: hidden ? null : { checked: 0, used: 0 },
    purpose: 'For content quality, not for rating people.',
    mine: [],
  };
}

const spread = (a: number, b: number, c: number, d: number) => ({
  checked: a,
  reviewed: b,
  recheck: c,
  error: 0,
  not_reviewed: d,
});

const pathOf = (title: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;

export const visualFollows: S['FollowedPagesDto'] = {
  items: frameSamples.You.D.following.rows.map((row, index) => ({
    path: index === 0 ? visualPage.path : pathOf(row.page),
    anchor: null,
    reason: 'attested',
    muted: false,
    createdAt: at,
    pageTitle: row.page,
    pageLabel: {
      label: labelOfT(row.t),
      spread: spread(1, 2, labelOfT(row.t) === 'recheck' ? 1 : 0, 1),
    },
    lastChange: { versionLabel: '20261123-2', at, summary: row.what.replace(/ \([^)]*\)$/, '') },
    checkAgain: row.action === 'Check again' ? [{ anchor: 'table', title: 'NA table' }] : [],
  })),
  nextCursor: null,
};

const activityState: Record<string, S['AttestationDto']['state']> = {
  Counting: 'active',
  'Stopped counting': 'on_old_version',
  'Fixed and published': 'fixed',
  Dismissed: 'dismissed',
  'Section now under re-check': 'active',
};

export const visualActivity: S['ActivityDto'] = {
  items: frameSamples.You.D.trust.rows.map((row, index) => {
    const report = row.what.startsWith('Reported');
    const used = row.what.startsWith('Used');
    return {
      id: `00000000-0000-4000-8000-00000000010${String(index)}`,
      path: pathOf(row.page),
      pageTitle: row.page,
      anchor: row.section.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      sectionTitle: row.section,
      versionLabel: '20261123-2',
      kind: report ? 'report' : used ? 'used' : 'checked',
      details: report
        ? { kind: row.what.includes('outdated') ? 'outdated' : 'wrong' }
        : used
          ? { use: 'acquisition', worked: 'yes' }
          : {
              result: 'supports',
              location: 'Table 2.1',
              comparedNumbers: true,
              source: { ref: 'Pawley', cited: true },
            },
      blocking: false,
      note: null,
      state: activityState[row.status] ?? 'active',
      outcomeReason:
        row.status === 'Dismissed' ? 'The table is for 20 °C; noted in the text.' : null,
      topicId: report ? '00000000-0000-4000-8000-000000000201' : null,
      createdAt: at,
      undoUntil: at,
    };
  }),
  nextCursor: null,
  counts: { all: 14, checks: 9, reports: 4 },
};

export const visualSummary: S['SummaryDto'] = {
  year: 2026,
  checksCounting: 9,
  reportsConfirmed: 3,
  suggestionsPublished: 5,
};

export const visualPrefs: S['NotificationPrefsDto'] = {
  events: {
    section_recheck: true,
    section_edited: true,
    report_outcome: true,
    weekly_summary: false,
  },
  channel: 'wiki',
};

export const visualNotices: S['NoticeListDto'] = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000301',
      event: 'section_recheck',
      path: visualPage.path,
      pageTitle: 'Confocal microscopy',
      anchor: 'principle',
      text: 'Principle went under re-check: a report was confirmed.',
      action: 'read_section',
      createdAt: at,
    },
    {
      id: '00000000-0000-4000-8000-000000000302',
      event: 'section_edited',
      path: 'point-spread-function.md',
      pageTitle: 'Point spread function',
      anchor: 'table',
      text: 'NA table was edited. Your check stopped counting.',
      action: 'check_again',
      createdAt: at,
    },
  ],
};

export const visualNotifications: S['NotificationListDto'] = {
  items: visualNotices.items.map((notice) => ({
    id: notice.id,
    event: notice.event,
    path: notice.path,
    pageTitle: notice.pageTitle,
    anchor: notice.anchor,
    text: notice.text,
    data: {},
    createdAt: notice.createdAt,
    readAt: null,
  })),
  nextCursor: null,
  unread: 2,
};

// ---------- F-12 Credibility ----------

const QTYPE: S['QueueItemDto']['type'][] = [
  'retraction',
  'report',
  'candidate',
  'candidate',
  'fix',
];
const OUTCOMES: Record<S['QueueItemDto']['type'], string[]> = {
  retraction: ['still_correct', 'confirm_error', 'keep_recheck'],
  report: ['confirm', 'confirm_error', 'dismiss'],
  flag: ['still_correct', 'confirm_error', 'keep_recheck'],
  candidate: ['yes', 'no', 'ask_authors'],
  pair: [],
  fix: [],
};

function queueItem(index: number): S['QueueItemDetailDto'] {
  const q = frameSamples.Credibility.Q[index];
  if (!q) throw new Error(`Missing F-12 sample ${String(index)}`);
  const [pageTitle = '', sectionTitle = ''] = q.where.split(' › ');
  const type = QTYPE[index] ?? 'flag';
  return {
    type,
    id: `00000000-0000-4000-8000-00000000040${String(index)}`,
    title: q.kind,
    why: q.why,
    section: {
      path: pathOf(pageTitle),
      pageTitle,
      anchor: sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      sectionTitle,
      sectionHash: '0'.repeat(64),
      label: { label: labelOfT(q.t), since: at, reviewerKind: null, reason: null },
    },
    reach: { linkedFrom: 14 - index * 2, teams: 4 - Math.min(index, 3) },
    at,
    outcomes: OUTCOMES[type],
    blocking: type === 'report',
    properties: q.props.map(({ k, v }) => ({ label: k, value: v })),
    reporter: null,
    topicId: null,
    downstream: q.down.map((line) => {
      const [page = line, section = ''] = line.split(' › ');
      return {
        path: pathOf(page),
        pageTitle: page,
        anchor: section.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sectionTitle: section || null,
        sectionHash: '0'.repeat(64),
        label: { label: 'reviewed', since: at, reviewerKind: null, reason: null },
      };
    }),
    decisions: [],
    can: { decide: OUTCOMES[type].length > 0 },
  };
}

export const visualQueueItems = frameSamples.Credibility.Q.map((_, index) => queueItem(index));

export function visualQueue(type: string | null): S['CredibilityQueueDto'] {
  const items = visualQueueItems
    .filter((item) => !type || item.type === type)
    .map(
      ({
        properties: _p,
        reporter: _r,
        topicId: _t,
        downstream: _d,
        decisions: _x,
        can: _c,
        ...item
      }) => item,
    );
  const count = (t: string) => visualQueueItems.filter((item) => item.type === t).length;
  return {
    items,
    nextCursor: null,
    counts: {
      all: visualQueueItems.length,
      report: count('report'),
      retraction: count('retraction'),
      flag: count('flag'),
      candidate: count('candidate'),
      pair: count('pair'),
      fix: count('fix'),
    },
  };
}

export const visualCredibilityPages: S['CredibilityPagesDto'] = {
  items: frameSamples.Credibility.cov.map((row) => ({
    path: pathOf(row.page),
    title: row.page,
    pageLabel: { label: labelOf(row.k), spread: spread(row.a, row.b, row.c, row.d) },
    oldestUnchecked: { anchor: 'history', title: row.oldest.replace(/ \([^)]*\)$/, ''), since: at },
    activeReaders30d: Number.parseInt(row.readers, 10) || 0,
  })),
  nextCursor: null,
  tiles: {
    checked: { sections: 427, changeThisWeek: 6 },
    reviewed: { sections: 479, changeThisWeek: 22 },
    recheck: { sections: 31, changeThisWeek: 2 },
    error: { sections: 1, changeThisWeek: 0 },
    not_reviewed: { sections: 104, changeThisWeek: 0 },
  },
};

const SOURCE_STATE: Record<string, S['CredibilitySourceDto']['state']> = {
  'Retracted 21 Nov': 'retracted',
  'Changed since cited': 'changed',
  'OK · archived copy': 'archived',
};

export const visualCredibilitySources: S['CredibilitySourcesDto'] = {
  items: frameSamples.Credibility.sources.map((row, index) => ({
    ref: `url:https://example.test/${row.path}`,
    name: row.path,
    tier: index === 3 ? 'low' : index === 0 ? 'high' : 'medium',
    state: SOURCE_STATE[row.status] ?? 'ok',
    citedBy: Number.parseInt(row.cited, 10) || 0,
    lastCheck: { at, result: row.checked },
  })),
  nextCursor: null,
};

export const visualGates: S['CredibilityGatesDto'] = {
  items: (
    [
      ['label_threshold', 'E8d', 'Use scores to move sections between labels.'],
      ['recheck_ordering', 'E8d', 'Order the re-check queue by score × reach.'],
      ['attestation_weights', 'E8b', 'Let reader checks count towards labels.'],
      ['report_detection', 'E8b', 'Flag sections from patterns in reports.'],
      ['assistant_disclosure', 'E8c', 'Show credibility to the assistant when it answers.'],
    ] as const
  ).map(([capability, experiment, description]) => ({
    capability,
    experiment,
    enabled: false,
    reference: null,
    updatedAt: null,
    updatedBy: null,
    description,
  })),
};
