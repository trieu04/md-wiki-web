import type { components } from '@md-wiki/contracts';
import { formatDate, formatRelative, labelMeta } from '@md-wiki/domain';
import type { Label } from '@md-wiki/domain';

export type Tree = components['schemas']['TreeDto'];
export type Recent = components['schemas']['RecentDto'];

export const trustLegend = [
  ['checked', 'A person compared this version with its source and it matched.'],
  ['reviewed', 'A reviewer approved the change. Nobody has checked it against the source yet.'],
  ['not_reviewed', 'Written before review started, or never approved.'],
  ['recheck', 'A problem was confirmed or a source was withdrawn. Use with care.'],
  ['error', 'Known to be wrong. Don’t rely on it until it is fixed.'],
] as const satisfies readonly (readonly [Label, string])[];

const spreadWords = [
  ['checked', 'checked'],
  ['reviewed', 'reviewed'],
  ['recheck', 'under re-check'],
  ['error', 'confirmed error'],
  ['not_reviewed', 'not reviewed'],
] as const satisfies readonly (readonly [Label, string])[];

export function homeTreeModel(tree: Tree) {
  const spread = { checked: 0, reviewed: 0, recheck: 0, error: 0, not_reviewed: 0 };
  const pageLabels = new Map<string, Label>();
  const topics = tree.topics.map(({ id, name, pageCount, pages }) => {
    for (const { path, pageLabel } of pages) {
      pageLabels.set(path, pageLabel.label);
      for (const [label] of spreadWords) spread[label] += pageLabel.spread[label];
    }
    return { id, name, pageCount, firstPage: pages[0]?.path };
  });
  const total = Object.values(spread).reduce((sum, count) => sum + count, 0);
  const parts = spreadWords.flatMap(([label, short]) =>
    spread[label] ? [{ label, short, percent: Math.round((100 * spread[label]) / total) }] : [],
  );
  return {
    topics,
    pageLabels,
    distribution: total
      ? {
          spread,
          title: `Across the wiki · ${total.toLocaleString('en-US')} ${total === 1 ? 'section' : 'sections'}`,
          caption: parts.map(({ short, percent }) => `${String(percent)}% ${short}`).join(' · '),
          ariaLabel: parts
            .map(({ label, percent }) => `${String(percent)}% ${labelMeta[label].toLowerCase()}`)
            .join(', '),
        }
      : null,
  };
}

/**
 * F-01 *Recent changes* subline and *What changed* (D-48 follow-up, D-102): a reviewed version
 * names its section (or the whole page) and the proposal title; an edit made outside review says so.
 */
export function recentChange(item: Recent['items'][number]) {
  if (item.proposalSlug !== null)
    return { section: item.sectionTitle ?? 'Whole page', change: item.summary ?? '' };
  return {
    section: '',
    change: item.changedOutsideReview ? 'Changed outside review' : '',
  };
}

export function recentRows(recent: Recent, labels: ReadonlyMap<string, Label>, now: Date) {
  return recent.items.map((item) => ({
    ...recentChange(item),
    path: item.path,
    pageTitle: item.pageTitle,
    key: JSON.stringify([item.path, item.versionLabel]),
    label: labels.get(item.path),
    timestamp: item.at,
    when: formatRelative(new Date(item.at), now),
  }));
}

// ---------- Phase 9: *On pages you use* and the scope toggle (F-01, §7.7.9) ----------

export type NoticeDto = components['schemas']['NoticeDto'];
export type HomeScope = 'mine' | 'all';

export const HOME_SCOPES: readonly { id: HomeScope; label: string }[] = [
  { id: 'mine', label: 'Pages you use' },
  { id: 'all', label: 'All pages' },
];

/** Signed-in people start on their pages; anonymous readers only have *All pages*. */
export function defaultScope(signedIn: boolean): HomeScope {
  return signedIn ? 'mine' : 'all';
}

const NOTICE_ACTION: Record<NoticeDto['action'], string> = {
  read_section: 'Read the section',
  see_affected: 'See what is affected',
  check_again: 'Check again',
  see_outcome: 'See the outcome',
};

function noticeTitle(notice: NoticeDto) {
  switch (notice.event) {
    case 'section_recheck':
      return `${notice.pageTitle}: a section you use is under re-check`;
    case 'section_edited':
      return `${notice.pageTitle}: a section you checked was edited`;
    case 'report_outcome':
      return `Your report on ${notice.pageTitle} was answered`;
    case 'report_received':
      return `New report on ${notice.pageTitle}`;
    case 'mention':
      return `You were mentioned on ${notice.pageTitle}`;
    default:
      return notice.pageTitle;
  }
}

export function noticeRow(notice: NoticeDto) {
  const page = `/wiki/${notice.path.split('/').map(encodeURIComponent).join('/')}`;
  return {
    key: notice.id,
    label: (notice.event === 'section_recheck' || notice.event === 'report_received'
      ? 'recheck'
      : notice.event === 'section_edited'
        ? 'not_reviewed'
        : 'reviewed') as Label,
    title: noticeTitle(notice),
    text: notice.text,
    action: NOTICE_ACTION[notice.action],
    href: notice.anchor ? `${page}#${encodeURIComponent(notice.anchor)}` : page,
    at: notice.createdAt,
    when: formatDate(new Date(notice.createdAt)),
  };
}
