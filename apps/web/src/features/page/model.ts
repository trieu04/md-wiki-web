import type { components } from '@md-wiki/contracts';
import { formatDate, formatDateTime, labelMeta, type Label } from '@md-wiki/domain';
import { markdownModel, type PageDto } from '../markdown/model';

export type TreeDto = components['schemas']['TreeDto'];
type SectionDto = PageDto['sections'][number];

export function pageHref(path: string) {
  return `/wiki/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** F-06 route: `/wiki/<path>/edit?section=<anchor>` (system-logic §7.2.9). */
export function editorHref(path: string, section?: string | null) {
  const href = `${pageHref(path)}/edit`;
  return section ? `${href}?${new URLSearchParams({ section }).toString()}` : href;
}

const joinNames = new Intl.ListFormat('en-GB');
const spreadLabels = {
  checked: 'checked',
  reviewed: 'reviewed',
  recheck: 'under re-check',
  error: 'with confirmed errors',
  not_reviewed: 'not reviewed',
} as const satisfies Record<Label, string>;
const spreadOrder = ['checked', 'reviewed', 'recheck', 'error', 'not_reviewed'] as const;
const sectionCount = (n: number) => `${String(n)} ${n === 1 ? 'section' : 'sections'}`;

export function pageHeaderModel(page: PageDto) {
  const { label, spread } = page.pageLabel;
  const count = spreadOrder.reduce((total, key) => total + spread[key], 0);
  const groups = spreadOrder.filter((key) => spread[key] > 0);
  const countLabel = (key: Label) => `${String(spread[key])} ${spreadLabels[key]}`;
  const status =
    label === 'recheck' && spread.recheck > 0
      ? `${sectionCount(spread.recheck)} under re-check`
      : label === 'error' && spread.error > 0
        ? `${sectionCount(spread.error)} with confirmed ${spread.error === 1 ? 'error' : 'errors'}`
        : labelMeta[label];
  return {
    path: page.path,
    title: page.title,
    topic: page.topic.name,
    pageHref: pageHref(page.path),
    historyHref: `${pageHref(page.path)}/history`,
    editHref: editorHref(page.path),
    updatedAt: page.updatedAt,
    updated: `updated ${formatDate(new Date(page.updatedAt))}`,
    maintainers: page.maintainers.length
      ? `Maintained by ${joinNames.format(page.maintainers.map(({ name }) => name))}`
      : null,
    usedBy:
      page.usedByTeams == null
        ? null
        : `used by ${String(page.usedByTeams)} ${page.usedByTeams === 1 ? 'team' : 'teams'}`,
    label,
    status,
    spread: count
      ? {
          counts: spread,
          ariaLabel: `${sectionCount(count)}: ${groups.map(countLabel).join(', ')}`,
          caption: groups
            .filter((key) => key !== label || (label !== 'recheck' && label !== 'error'))
            .map(countLabel)
            .join(' · '),
        }
      : null,
  };
}

export function topicModel(page: PageDto, tree: TreeDto) {
  const pages = tree.topics.find(({ id }) => id === page.topic.id)?.pages ?? [];
  return {
    title: page.topic.name,
    links: pages.map(({ path, title, pageLabel }) => ({
      href: pageHref(path),
      title,
      label: pageLabel.label,
      ariaLabel: `${title}: ${labelMeta[pageLabel.label]}`,
      current: path === page.path ? ('page' as const) : undefined,
    })),
  };
}

function warning(section: SectionDto) {
  if (!section.warn) return null;
  return {
    title:
      section.label.label === 'error'
        ? 'Use with care: this section contains a confirmed error.'
        : 'Use with care: this section is being re-checked.',
    reason: section.warn.reason,
    fixHref: section.warn.fixProposalSlug
      ? `/work/proposals/${encodeURIComponent(section.warn.fixProposalSlug)}`
      : null,
  };
}

export function pageArticleModel(page: PageDto) {
  const markdown = markdownModel(page);
  return {
    empty: !page.markdown.trim(),
    // F-03 starts with the section that carries the warning selected.
    defaultAnchor: page.sections.find(({ warn }) => warn)?.anchor ?? '',
    links: page.sections.map(({ title, anchor, label }) => ({
      title,
      anchor,
      label: label.label,
      ariaLabel: `${title}: ${labelMeta[label.label]}`,
    })),
    markdown: {
      ...markdown,
      groups: markdown.groups.map(({ section, content }) => {
        const [first, ...rest] = content.children;
        const heading =
          section &&
          section.level > 0 &&
          first?.type === 'element' &&
          first.tagName === `h${String(section.level)}`
            ? first
            : null;
        return {
          section,
          heading,
          content: heading ? { ...content, children: rest } : content,
          warning: section ? warning(section) : null,
        };
      }),
    },
  };
}

export type PageHeaderModel = ReturnType<typeof pageHeaderModel>;
export type TopicModel = ReturnType<typeof topicModel>;
export type PageArticleModel = ReturnType<typeof pageArticleModel>;

type HistoryDto = components['schemas']['HistoryDto'];
export function historyModel(pages: readonly HistoryDto[]) {
  return pages.flatMap(({ items }) =>
    items.map(({ capturedAt, ...version }) => ({
      ...version,
      capturedAt,
      captured: formatDateTime(new Date(capturedAt)),
    })),
  );
}

const SUGGEST_ROLES = new Set(['contributor', 'reviewer', 'publisher', 'owner']);

/** *Suggest an edit* is shown to roles ≥ contributor (system-logic §7.2.9). */
export function canSuggest(roles: readonly string[] | undefined) {
  return !!roles?.some((role) => SUGGEST_ROLES.has(role));
}

/** F-03 *Changed outside review* (D-47, D-103): derived warn Callout, shown only when flagged. */
export function changedOutsideReviewNote(page: Pick<PageDto, 'changedOutsideReview'>) {
  return page.changedOutsideReview
    ? {
        title: 'Changed outside review',
        text: 'This page was edited directly in the wiki folder after its last review. Sections that changed show Not reviewed until a reviewer approves them.',
      }
    : null;
}

type FollowLike = { path: string; anchor: string | null; muted: boolean };

/** The viewer follows the page itself, unmuted (F-03 *Following*, D-171). */
export function isFollowing(follows: readonly FollowLike[], path: string) {
  return follows.some((follow) => follow.path === path && follow.anchor == null && !follow.muted);
}

/** The section the reader acts on: the hash they read (SECTION_CHANGED otherwise, §7.7.6). */
export function sectionFor(page: PageDto, anchor: string) {
  const section = page.sections.find((item) => item.anchor === anchor);
  return section
    ? { path: page.path, anchor: section.anchor, sectionHash: section.hash, title: section.title }
    : null;
}
