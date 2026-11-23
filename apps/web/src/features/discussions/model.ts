import type { components } from '@md-wiki/contracts';
import type { StatusTone } from '../../ui/StatusDot';
import { userInitials } from '../navigation/model';
import { pageHref } from '../page/model';
import { age } from '../review/model';

export type TopicListDto = components['schemas']['TopicListDto'];
export type TopicListItemDto = components['schemas']['TopicListItemDto'];
export type TopicDetailDto = components['schemas']['TopicDetailDto'];
export type TopicEntryDto = components['schemas']['TopicEntryDto'];
export type TopicCreateInput = components['schemas']['TopicCreateInput'];
export type CloseOutcome = components['schemas']['TopicCloseInput']['outcome'];
export type TopicFilter = keyof components['schemas']['TopicCountsDto'];

export const TOPIC_FILTERS = ['open', 'mine', 'closed', 'all'] as const satisfies TopicFilter[];
const filterLabels: Record<TopicFilter, string> = {
  open: 'Open',
  mine: 'Mine',
  closed: 'Closed',
  all: 'All',
};

/** `?filter=` of /work/discussions; anything else is the default `open` (system-logic §7.5.5). */
export function topicFilter(value: unknown): TopicFilter {
  return TOPIC_FILTERS.find((filter) => filter === value) ?? 'open';
}

/** F-11 filter pills: "Open 3", "Mine 2", "Closed 41", "All" (the frame draws no count on All). */
export function topicFilters(counts: TopicListDto['counts'] | undefined) {
  return TOPIC_FILTERS.map((id) => ({
    id,
    label: counts && id !== 'all' ? `${filterLabels[id]} ${String(counts[id])}` : filterLabels[id],
  }));
}

export function discussionsHref({ filter, topic }: { filter?: TopicFilter; topic?: string }) {
  const params = new URLSearchParams();
  if (filter) params.set('filter', filter);
  if (topic) params.set('topic', topic);
  const query = params.toString();
  return `/work/discussions${query ? `?${query}` : ''}`;
}

/** Derived compose route (D-119): `/ask?path=&section=&q=`. */
export function askHref({
  path,
  section,
  q,
}: {
  path?: string | null | undefined;
  section?: string | null | undefined;
  q?: string | null | undefined;
}) {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (section) params.set('section', section);
  if (q?.trim()) params.set('q', q.trim());
  const query = params.toString();
  return `/ask${query ? `?${query}` : ''}`;
}

/** F-02 *Ask a question*: the closest page is the best hit's page and section (ux.md §2). */
export function searchAskHref(
  q: string,
  hits: readonly { path: string; anchor: string }[] | undefined,
) {
  const top = hits?.[0];
  return askHref({ path: top?.path, section: top?.anchor, q });
}

export function topicWhere(topic: { path: string; anchor: string | null }) {
  return topic.anchor ? `${topic.path}#${topic.anchor}` : topic.path;
}

const statusText: Record<TopicListItemDto['status'], [StatusTone, string]> = {
  open: ['pending', 'Open'],
  on_hold: ['pending', 'On hold'],
  resolved: ['closed', 'Resolved'],
  rejected: ['closed', 'Rejected'],
};

/** Status line of a topic: a topic holding a proposal says so (F-11 "Holds psf-fwhm-table"). */
export function topicStatus(topic: Pick<TopicListItemDto, 'status' | 'proposal'>): {
  tone: StatusTone;
  text: string;
} {
  if (topic.proposal?.holds) return { tone: 'escalated', text: `Holds ${topic.proposal.slug}` };
  const [tone, text] = statusText[topic.status];
  return { tone, text };
}

const replies = (n: number) => `${String(n)} ${n === 1 ? 'reply' : 'replies'}`;

export type TopicRow = {
  id: string;
  title: string;
  where: string;
  tone: StatusTone;
  status: string;
  meta: string;
  updatedAt: string;
};

export function topicRow(item: TopicListItemDto, now: Date): TopicRow {
  const status = topicStatus(item);
  return {
    id: item.id,
    title: item.title,
    where: topicWhere(item),
    tone: status.tone,
    status: status.text,
    meta: `${replies(item.replies)} · ${age(item.updatedAt, now)}`,
    updatedAt: item.updatedAt,
  };
}

/** The selected topic: `?topic=` when given, else the first listed one. */
export function selectedTopicId(topic: string | undefined, items: readonly { id: string }[]) {
  return topic ?? items[0]?.id ?? null;
}

const outcomeLabels: Record<CloseOutcome, string> = {
  resolved: 'Resolved',
  rejected: 'Rejected',
  on_hold: 'On hold',
};

/** Thread properties (F-11 `dl`): who opened it, who takes part, the proposal, closing, version. */
export function threadProps(detail: TopicDetailDto) {
  const others = detail.participants.filter(({ id }) => id !== detail.author.id);
  return [
    { k: 'Opened by', v: detail.author.name },
    ...(others.length ? [{ k: 'Participants', v: others.map(({ name }) => name).join(', ') }] : []),
    ...(detail.proposal
      ? [
          {
            k: 'Proposal',
            v: `${detail.proposal.slug} · ${detail.proposal.holds ? 'held by this topic' : detail.proposal.state}`,
          },
        ]
      : []),
    ...(detail.closed
      ? [
          {
            k: 'Closed by',
            v: `${detail.closed.by.name} · ${outcomeLabels[detail.closed.outcome]}`,
          },
          { k: 'Rationale', v: detail.closed.reason },
        ]
      : []),
    { k: 'Version', v: `discussion v${String(detail.version)}` },
  ];
}

function entryAction(entry: TopicEntryDto) {
  switch (entry.kind) {
    case 'open':
      return 'opened the topic';
    case 'comment':
      return entry.parentSeq && entry.parentSeq > 1
        ? `reply to #${String(entry.parentSeq)}`
        : 'reply';
    case 'agreement':
      return `agrees with #${String(entry.agreesWith ?? 1)}`;
    case 'close':
      return `closed as ${outcomeLabels[entry.outcome ?? 'resolved']}`;
    case 'reopen':
      return 'reopened';
  }
}

export type ThreadPost = {
  key: string;
  seq: number;
  initials: string;
  agent: boolean;
  who: string;
  action: string;
  time: string;
  at: string;
  text: string;
};

export function threadPosts(entries: readonly TopicEntryDto[], now: Date): ThreadPost[] {
  return entries.map((entry) => ({
    key: entry.id,
    seq: entry.seq,
    initials: userInitials(entry.author.name),
    agent: entry.author.kind === 'agent',
    who: entry.author.name,
    action: entryAction(entry),
    time: age(entry.createdAt, now),
    at: entry.createdAt,
    text: entry.body,
  }));
}

/** Which controls the thread offers, from `can` (the web never re-derives permissions). */
export function threadActions(detail: Pick<TopicDetailDto, 'can' | 'status' | 'proposal'>) {
  const close: CloseOutcome[] = detail.can.close
    ? (['resolved', 'rejected', 'on_hold'] as const).filter(
        // on_hold → on_hold is not a transition (system-logic §7.5.2).
        (outcome) => !(outcome === 'on_hold' && detail.status === 'on_hold'),
      )
    : [];
  const any = detail.can.comment || close.length > 0 || detail.can.reopen;
  return {
    reply: detail.can.comment,
    close: close.map((value) => ({ value, label: outcomeLabels[value] })),
    reopen: detail.can.reopen,
    any,
    placeholder: detail.proposal
      ? 'Write a reply. Posting a reply locks open review decisions until reviewers reread.'
      : 'Write a reply.',
    note: detail.proposal
      ? 'Closing needs a rationale. When this topic closes as resolved, the held proposal goes back to its reviewer.'
      : 'Closing needs a rationale.',
  };
}

/** Why a thread has no controls for the viewer. */
export function readOnlyNote(detail: Pick<TopicDetailDto, 'proposal' | 'status'>) {
  if (detail.proposal && detail.proposal.state !== 'pending')
    return 'The proposal was decided. This thread is kept as history.';
  if (detail.status === 'resolved' || detail.status === 'rejected') return 'This topic is closed.';
  return 'You can read this topic but not reply to it.';
}

export type ThreadIntent =
  { kind: 'reply' } | { kind: 'close'; outcome: CloseOutcome } | { kind: 'reopen' };

/** Client check before a thread write: replies and rationales are required. */
export function threadTextError(intent: ThreadIntent, text: string) {
  if (text.trim()) return null;
  switch (intent.kind) {
    case 'reply':
      return 'Write a reply first.';
    case 'close':
      return 'Write the rationale in the reply box before closing.';
    case 'reopen':
      return 'Write why you reopen this topic in the reply box.';
  }
}

export function replyStorageKey(id: string) {
  return `mw:form:topic:${id}`;
}

export function askStorageKey(path: string | null) {
  return `mw:form:ask:${path ?? ''}`;
}

export const TITLE_MAX = 120;
export const BODY_MAX = 20_000;

export type AskDraft = { path: string; section: string; title: string; body: string };

/** Field errors of the *Ask a question* form (limits from system-logic §7.5.4). */
export function askErrors(draft: AskDraft) {
  const title = draft.title.trim();
  const body = draft.body.trim();
  return {
    ...(!draft.path && { path: 'Choose the page your question is about.' }),
    ...(!title
      ? { title: 'Give your question a short title.' }
      : title.length > TITLE_MAX && {
          title: `Keep the title under ${String(TITLE_MAX + 1)} characters.`,
        }),
    ...(!body
      ? { body: 'Write your question.' }
      : body.length > BODY_MAX && { body: 'This question is too long.' }),
  } as Partial<Record<keyof AskDraft, string>>;
}

export function askInput(draft: AskDraft): TopicCreateInput {
  return {
    path: draft.path,
    anchor: draft.section || null,
    title: draft.title.trim(),
    body: draft.body.trim(),
  };
}

/** Section choices of the compose form: the whole page, then each section of the page. */
export function sectionOptions(sections: readonly { anchor: string; title: string }[] | undefined) {
  return [
    { value: '', label: 'Whole page' },
    ...(sections ?? []).map(({ anchor, title }) => ({ value: anchor, label: title })),
  ];
}

/** Page choices of the compose form from the topic tree, grouped by topic. */
export function pageOptions(
  tree: components['schemas']['TreeDto'] | undefined,
  current: string | null,
) {
  const groups = (tree?.topics ?? []).map(({ id, name, pages }) => ({
    id,
    name,
    pages: pages.map(({ path, title }) => ({ value: path, label: `${title} (${path})` })),
  }));
  const known = groups.some(({ pages }) => pages.some(({ value }) => value === current));
  return { groups, extra: current && !known ? current : null };
}

export function sectionHref(topic: { path: string; anchor: string | null }) {
  return `${pageHref(topic.path)}${topic.anchor ? `#${encodeURIComponent(topic.anchor)}` : ''}`;
}
