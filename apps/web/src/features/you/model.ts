import type { components } from '@md-wiki/contracts';
import { formatDate, formatRelative, formatTime, type Label } from '@md-wiki/domain';
import { editorHref } from '../editor/model';
import { pageHref } from '../page/model';

export type SuggestionDto = components['schemas']['SuggestionDto'];
export type SuggestionsDto = components['schemas']['SuggestionsDto'];

export type SuggestionRow = {
  key: string;
  page: string;
  pageHref: string;
  section: string;
  what: string;
  label: Label;
  status: string;
  detail: string;
  action: string;
  href: string;
};

const finished = {
  approved: { status: 'Approved', label: 'reviewed' },
  published: { status: 'Published', label: 'reviewed' },
  rejected: { status: 'Not accepted', label: 'not_reviewed' },
} as const satisfies Record<string, { status: string; label: Label }>;

/** F-05 *Your suggestions* rows (D-69). */
export function suggestionRow(item: SuggestionDto, now: Date): SuggestionRow {
  const at = new Date(item.at);
  const base = {
    key: `${item.kind}:${item.id}`,
    page: item.pageTitle,
    pageHref: pageHref(item.targetPath),
    section: item.sectionTitle ?? 'Whole page',
  };
  const edit = editorHref(item.targetPath, item.section);
  if (item.needsAttention)
    return {
      ...base,
      what: item.kind === 'draft' ? `Draft: ${item.title}` : item.title,
      label: 'recheck',
      status: 'Needs your attention',
      detail: 'The page changed under it',
      action: 'Resolve',
      href:
        item.kind === 'draft'
          ? edit
          : `/me/suggestions/${encodeURIComponent(item.slug ?? item.id)}/resolve`,
    };
  if (item.kind === 'draft')
    return {
      ...base,
      what: `Draft: ${item.title}`,
      label: 'not_reviewed',
      status: 'Draft',
      detail: `Saved ${formatTime(at)}`,
      action: 'Continue',
      href: edit,
    };
  if (item.state === 'pending' || item.state === 'stale')
    return {
      ...base,
      what: item.title,
      label: 'not_reviewed',
      status: 'Waiting for review',
      detail: `Submitted ${formatRelative(at, now)}`,
      action: 'View',
      href: base.pageHref,
    };
  const done = Object.hasOwn(finished, item.state)
    ? finished[item.state as keyof typeof finished]
    : { status: 'Waiting for review', label: 'not_reviewed' as const };
  return { ...base, what: item.title, ...done, detail: '', action: 'View', href: base.pageHref };
}

export function suggestionsModel(pages: readonly SuggestionsDto[], now: Date) {
  return {
    total: pages[0]?.total ?? 0,
    rows: pages.flatMap((page) => page.items.map((item) => suggestionRow(item, now))),
  };
}

export function youSubtitle(name: string | null | undefined, team?: string | null) {
  return `${name ?? 'You'}${team ? ` · ${team}` : ''}. Pages you follow, and what happened to your checks, reports and suggestions.`;
}

// ---------- Phase 9: Followed pages, checks and reports, preferences (F-05, §7.7.9) ----------

export type FollowedPageDto = components['schemas']['FollowedPageDto'];
export type AttestationDto = components['schemas']['AttestationDto'];
export type NotificationPrefsDto = components['schemas']['NotificationPrefsDto'];
export type SummaryDto = components['schemas']['SummaryDto'];

export const YOU_TABS = ['following', 'trust', 'suggestions'] as const;
export type YouTab = (typeof YOU_TABS)[number];
export function youTab(value: unknown): YouTab {
  return YOU_TABS.includes(value as YouTab) ? (value as YouTab) : 'following';
}

const labelStatus: Record<Label, string> = {
  checked: 'Checked against source',
  reviewed: 'Reviewed',
  not_reviewed: 'Not reviewed',
  recheck: 'Under re-check',
  error: 'Confirmed error',
};

function pageStatus({ label, spread }: FollowedPageDto['pageLabel']) {
  if (label === 'recheck' && spread.recheck)
    return `${String(spread.recheck)} ${spread.recheck === 1 ? 'section' : 'sections'} under re-check`;
  if (label === 'error' && spread.error)
    return `${String(spread.error)} ${spread.error === 1 ? 'section' : 'sections'} with confirmed errors`;
  return labelStatus[label];
}

export type FollowRow = {
  key: string;
  path: string;
  page: string;
  pageHref: string;
  section: string;
  what: string;
  label: Label;
  status: string;
  detail: string;
  action: 'Check again' | 'Open';
  href: string;
  muted: boolean;
};

export function followRow(item: FollowedPageDto, now: Date): FollowRow {
  const href = pageHref(item.path);
  const again = item.checkAgain[0];
  const change = item.lastChange.summary ?? `New version ${item.lastChange.versionLabel}`;
  return {
    key: `${item.path}#${item.anchor ?? ''}`,
    path: item.path,
    page: item.pageTitle,
    pageHref: href,
    section: item.anchor ? `Section ${item.anchor}` : 'Whole page',
    what: `${change} (${formatRelative(new Date(item.lastChange.at), now)})`,
    label: item.pageLabel.label,
    status: item.muted ? 'Muted' : pageStatus(item.pageLabel),
    detail: item.checkAgain.length
      ? `Your old check on ${item.checkAgain.map(({ title }) => title).join(', ')} stopped counting`
      : '',
    action: again ? 'Check again' : 'Open',
    href: again ? `${href}#${encodeURIComponent(again.anchor)}` : href,
    muted: item.muted,
  };
}

const USE_TEXT: Record<string, string> = {
  acquisition: 'setting up an acquisition',
  analysis: 'analysing or reporting data',
  training: 'training someone',
  protocol: 'writing a protocol or paper',
  other: 'something else',
};
const RESULT_TEXT: Record<string, string> = {
  supports: 'supports',
  partly: 'partly supports',
  contradicts: 'contradicts',
  unverifiable: 'could not check',
};
const REPORT_TEXT: Record<string, string> = {
  wrong: 'wrong',
  outdated: 'outdated',
  unclear: 'unclear',
  source: 'missing or weak source',
  other: 'something else',
};

function str(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function activityWhat(item: AttestationDto): string {
  const date = formatDate(new Date(item.createdAt));
  const details = item.details as Record<string, unknown>;
  switch (item.kind) {
    case 'checked':
      return `Checked a source: ${RESULT_TEXT[str(details.result)] ?? 'recorded'} (${date})`;
    case 'used':
      return `Used in practice: ${USE_TEXT[str(details.use)] ?? 'recorded'} (${date})`;
    case 'useful':
      return `Marked useful (${date})`;
    default:
      return `Reported: ${REPORT_TEXT[str(details.kind)] ?? 'a problem'} (${date})`;
  }
}

const STATE: Record<AttestationDto['state'], { status: string; label: Label; detail: string }> = {
  active: { status: 'Counting', label: 'checked', detail: 'Counts for this version' },
  downweighted: {
    status: 'Counting, with less weight',
    label: 'reviewed',
    detail: 'Reciprocal attestations between two readers',
  },
  on_old_version: {
    status: 'Stopped counting',
    label: 'not_reviewed',
    detail: 'The section was edited since',
  },
  stale: {
    status: 'Stopped counting',
    label: 'not_reviewed',
    detail: 'The section was edited since',
  },
  withdrawn: { status: 'Withdrawn', label: 'not_reviewed', detail: '' },
  open: { status: 'Open', label: 'reviewed', detail: 'Waiting for a page author' },
  confirmed: {
    status: 'Confirmed',
    label: 'recheck',
    detail: 'The section is under re-check until it is fixed',
  },
  confirmed_error: {
    status: 'Confirmed as an error',
    label: 'error',
    detail: 'Readers see a warning until it is fixed',
  },
  dismissed: { status: 'Dismissed', label: 'not_reviewed', detail: '' },
  fixed: { status: 'Fixed and published', label: 'reviewed', detail: '' },
};

export type ActivityRow = {
  key: string;
  page: string;
  section: string;
  what: string;
  label: Label;
  status: string;
  detail: string;
  action: 'Check again' | 'Reply' | 'View';
  href: string;
};

export function activityRow(item: AttestationDto): ActivityRow {
  const state = STATE[item.state];
  const href = `${pageHref(item.path)}#${encodeURIComponent(item.anchor)}`;
  const again =
    item.kind === 'checked' && (item.state === 'on_old_version' || item.state === 'stale');
  const reply = item.kind === 'report' && item.state === 'dismissed' && item.topicId;
  return {
    key: item.id,
    page: item.pageTitle,
    section: item.sectionTitle ?? item.anchor,
    what: activityWhat(item),
    label: state.label,
    status: state.status,
    detail:
      item.outcomeReason && (item.state === 'dismissed' || item.state === 'fixed')
        ? `“${item.outcomeReason}”`
        : state.detail,
    action: again ? 'Check again' : reply ? 'Reply' : 'View',
    href: reply ? `/work/discussions?topic=${encodeURIComponent(item.topicId ?? '')}` : href,
  };
}

export const PREF_ROWS: readonly { id: keyof NotificationPrefsDto['events']; label: string }[] = [
  { id: 'section_recheck', label: 'A section I used goes under re-check' },
  { id: 'section_edited', label: 'A section I checked is edited' },
  { id: 'report_outcome', label: 'My report is confirmed, dismissed or fixed' },
  { id: 'weekly_summary', label: 'Weekly summary of followed pages' },
];

export function summaryTiles(summary: SummaryDto) {
  return [
    { label: 'Source checks still counting', value: String(summary.checksCounting) },
    { label: 'Reports confirmed', value: String(summary.reportsConfirmed) },
    { label: 'Suggestions published', value: String(summary.suggestionsPublished) },
  ];
}
