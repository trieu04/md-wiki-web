import type { components } from '@md-wiki/contracts';
import { formatRelative, formatTime, type Label } from '@md-wiki/domain';
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

export function youSubtitle(name: string | null | undefined) {
  return `${name ?? 'You'} · Your drafts and suggestions, and what happened to them.`;
}
