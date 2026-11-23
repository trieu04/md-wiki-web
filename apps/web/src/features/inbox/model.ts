import type { components } from '@md-wiki/contracts';
import { discussionsHref } from '../discussions/model';
import { pageHref } from '../page/model';
import { age, proposalHref } from '../review/model';

type S = components['schemas'];
export type InboxDto = S['InboxDto'];
export type InboxItemDto = S['InboxItemDto'];
export type InboxTab = 'all' | 'decide' | 'check' | 'spot' | 'mentions' | 'done';
export type SpotCheckDto = S['SpotCheckDto'];

export const INBOX_TABS: readonly { id: InboxTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'decide', label: 'Decide' },
  { id: 'check', label: 'Check' },
  { id: 'spot', label: 'Spot checks' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'done', label: 'Done' },
];

/** `?tab=` of /work; anything else is `all` (system-logic §7.8.8). */
export function inboxTab(value: unknown): InboxTab {
  return INBOX_TABS.find(({ id }) => id === value)?.id ?? 'all';
}

const KIND_LABEL: Record<InboxItemDto['kind'], string> = {
  review: 'Review',
  rereview: 'Re-review',
  discussion: 'Discussion',
  spot_check: 'Spot check',
  mention: 'Mention',
  check: 'Check',
};
/** F-08 dot colour per kind: decisions orange, checks red (square), spot checks accent. */
export type InboxDot = 'decide' | 'check' | 'spot' | 'mention' | 'done';
const TRIGGER_TEXT: Record<string, string> = {
  quality_missing: 'No current quality check',
  quality_blocking: 'A high-severity quality finding',
  dispute_or_report: 'An open dispute, hold or report',
  sourced_meaning: 'A number, unit or negation changes in a sentence with a source',
  dropped_hedge: 'A hedge was removed from a sourced sentence',
  checked_section: 'Changes a section checked against its source',
  source_problem: 'A retracted or low-tier source is cited',
  contradiction: 'Contradicts another page',
  wiki_meta: 'A change under wiki-meta/',
  agent_edits_human_pages: 'An agent edits a page written by people',
  judgement: 'The reviewer agent was unsure',
};
export function triggerText(id: string) {
  return TRIGGER_TEXT[id] ?? (id.startsWith('custom:') ? `Owner rule ${id.slice(7)}` : id);
}

export type InboxRow = {
  id: string;
  type: string;
  dot: InboxDot;
  age: string;
  title: string;
  where: string;
};
export type InboxDetail = {
  type: string;
  dot: InboxDot;
  title: string;
  why: string;
  props: { k: string; v: string }[];
  ai: string[];
  primary: { label: string; href: string };
  spotCheckId: string | null;
};

function dotOf(item: InboxItemDto): InboxDot {
  if (item.done) return 'done';
  if (item.tab === 'check') return 'check';
  if (item.tab === 'spot') return 'spot';
  if (item.tab === 'mentions') return 'mention';
  return 'decide';
}

function whereOf(item: InboxItemDto) {
  const at = item.anchor ? `${item.path}#${item.anchor}` : item.path;
  return item.proposal ? `${at} · ${item.proposal.slug}` : at;
}

export function inboxRow(item: InboxItemDto, now: Date): InboxRow {
  return {
    id: item.id,
    type: KIND_LABEL[item.kind],
    dot: dotOf(item),
    age: age(item.at, now),
    title: item.title,
    where: whereOf(item),
  };
}

/** The primary action of an item (F-08 right panel). */
export function primaryOf(item: InboxItemDto): { label: string; href: string } {
  switch (item.action) {
    case 'decide':
      return {
        label: 'Open review',
        href: item.proposal ? proposalHref(item.proposal.slug) : '/work/proposals',
      };
    case 'discuss':
    case 'reply':
      return {
        label: item.action === 'reply' ? 'Reply' : 'Open discussion',
        href: item.topicId ? discussionsHref({ topic: item.topicId }) : discussionsHref({}),
      };
    case 'spot_check':
      return {
        label: 'Open review',
        href: item.proposal ? proposalHref(item.proposal.slug) : '/work',
      };
    default:
      return item.tab === 'check'
        ? { label: 'Open in Credibility', href: '/work/credibility' }
        : {
            label: 'Open page',
            href: pageHref(item.path) + (item.anchor ? `#${item.anchor}` : ''),
          };
  }
}

/** Agent notes are free text; one bullet per non-empty line (at most 6). */
export function agentNotes(notes: string | null): string[] {
  if (!notes) return [];
  return notes
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function inboxDetail(item: InboxItemDto, now: Date): InboxDetail {
  const props: { k: string; v: string }[] = [];
  if (item.proposal)
    props.push({ k: 'Proposal', v: `${item.proposal.slug} · ${item.proposal.title}` });
  props.push({ k: 'Page', v: item.pageTitle || item.path });
  if (item.triggers.length)
    props.push({
      k: item.triggers.length > 1 ? 'Triggers' : 'Trigger',
      v: item.triggers.map(triggerText).join('; '),
    });
  if (item.from)
    props.push({
      k: 'From',
      v: `${item.from.name}${item.from.kind === 'agent' ? ' (agent)' : ''}`,
    });
  props.push({ k: item.done ? 'Done' : 'Waiting since', v: `${age(item.at, now)} ago` });
  if (item.reminders > 0) props.push({ k: 'Reminders', v: `${String(item.reminders)} sent` });
  return {
    type: KIND_LABEL[item.kind],
    dot: dotOf(item),
    title: item.title,
    why: item.why,
    props,
    ai: agentNotes(item.agentNotes),
    primary: primaryOf(item),
    spotCheckId: item.done ? null : item.spotCheckId,
  };
}

/** The selected item: the `?item=` id when listed, else the first. */
export function selectedItem<T extends { id: string }>(id: string | undefined, rows: readonly T[]) {
  return rows.find((r) => r.id === id) ?? rows[0];
}

/** Inbox count in the WorkNav: open items (D-215 `all`). */
export function inboxNavCount(counts: InboxDto['counts'] | undefined) {
  return counts?.all;
}
