import type { components } from '@md-wiki/contracts';
import { formatTime, parseStatusBlock, type ErrorCode } from '@md-wiki/domain';
import type { DiffRow } from '../../ui/DiffView';
import type { PublishStep } from '../../ui/PublishProgress';
import type { StatusTone } from '../../ui/StatusDot';

export type ProposalListDto = components['schemas']['ProposalListDto'];
export type ProposalListItemDto = components['schemas']['ProposalListItemDto'];
export type ProposalDetailDto = components['schemas']['ProposalDetailDto'];
export type ProposalDiffDto = components['schemas']['ProposalDiffDto'];
export type PublicationPhase = components['schemas']['PublicationPhase'];
export type ProposalTab = keyof components['schemas']['TabCountsDto'];
type UserRefDto = components['schemas']['UserRefDto'];

export const PROPOSAL_TAB_IDS = [
  'open',
  'stale',
  'blocked',
  'published',
  'rejected',
  'all',
] as const satisfies readonly ProposalTab[];
const tabLabels: Record<ProposalTab, string> = {
  open: 'Open',
  stale: 'Stale',
  blocked: 'Blocked',
  published: 'Published',
  rejected: 'Rejected',
  all: 'All',
};

/** `?tab=` of /work/proposals; anything else is the default `open` tab. */
export function proposalTab(value: unknown): ProposalTab {
  return PROPOSAL_TAB_IDS.find((tab) => tab === value) ?? 'open';
}

/** F-09 tabs with counts (D-87). */
export function proposalTabs(counts: ProposalListDto['counts'] | undefined) {
  return PROPOSAL_TAB_IDS.map((id) => ({
    id,
    label: tabLabels[id],
    ...(counts && { count: counts[id] }),
  }));
}

/** F-09 *Age*: "12 min", "2 h", "1 d" (no "ago"). */
export function age(at: string, now: Date) {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h`;
  return `${String(Math.floor(hours / 24))} d`;
}

export const OPEN_PHASES: readonly PublicationPhase[] = ['prepared', 'writing', 'written'];

type Status = { tone: StatusTone; status: string; detail: string };

/** Status column of F-09 and the header status of F-10, from state + latest phase. */
export function proposalStatus(item: {
  state: ProposalListItemDto['state'];
  tab: ProposalListItemDto['tab'];
  phase: PublicationPhase | null;
  withdrawn: boolean;
  conflict: boolean;
  updatedAt: string;
  publishedVersion?: string | null;
  autoPublished?: boolean | null;
  /** `discussion.disputed`: a hold or an open dispute blocks approval (D-111). */
  disputed?: boolean;
}): Status {
  if (item.tab === 'blocked')
    return {
      tone: 'error',
      status: 'Blocked',
      detail: `Publish outcome unknown since ${formatTime(new Date(item.updatedAt))}`,
    };
  switch (item.state) {
    case 'pending':
      if (item.disputed)
        return { tone: 'escalated', status: 'Disputed', detail: 'Approval held for discussion' };
      return {
        tone: 'pending',
        status: 'Pending',
        detail: item.conflict ? 'Page changed after the author read it' : 'Waiting for a decision',
      };
    case 'approved':
      if (item.phase === 'not_written')
        return { tone: 'publishing', status: 'Approved', detail: 'Waiting to publish again' };
      return item.phase && OPEN_PHASES.includes(item.phase)
        ? { tone: 'publishing', status: 'Approved · publishing', detail: 'Publishing now' }
        : { tone: 'publishing', status: 'Approved', detail: 'Waiting to be published' };
    case 'stale':
      return { tone: 'error', status: 'Stale', detail: 'Page changed after the author read it' };
    case 'published':
      return {
        tone: 'published',
        status: 'Published',
        detail: [item.autoPublished ? 'Automatically' : null, item.publishedVersion]
          .filter(Boolean)
          .join(' · '),
      };
    default:
      return item.withdrawn
        ? { tone: 'closed', status: 'Withdrawn', detail: 'Withdrawn by the author' }
        : { tone: 'closed', status: 'Rejected', detail: 'Sent back with a reason' };
  }
}

const names = (users: readonly UserRefDto[]) => users.map(({ name }) => name).join(', ');

/** F-09 *With*: who has the proposal now. */
export function proposalWith(item: ProposalListItemDto) {
  if (item.tab === 'blocked') return 'Owner (investigate)';
  if (item.state === 'stale') return `${item.submitter.name} (resubmit)`;
  if (item.state === 'pending') return item.assignees.length ? names(item.assignees) : 'Nobody yet';
  if (item.decision) return `Decided by ${item.decision.reviewer.name}`;
  return '—';
}

export function proposalHref(slug: string) {
  return `/work/proposals/${encodeURIComponent(slug)}`;
}

export type ProposalRow = Status & {
  slug: string;
  href: string;
  title: string;
  where: string;
  author: string;
  kind: string;
  with: string;
  age: string;
  createdAt: string;
};

export function proposalRow(item: ProposalListItemDto, now: Date): ProposalRow {
  return {
    ...proposalStatus(item),
    slug: item.slug,
    href: proposalHref(item.slug),
    title: item.title,
    where: item.section ? `${item.targetPath}#${item.section}` : item.targetPath,
    author: item.submitter.name,
    kind: item.submitter.kind === 'agent' ? 'agent' : 'person',
    with: proposalWith(item),
    age: age(item.createdAt, now),
    createdAt: item.createdAt,
  };
}

/** Client-side *Filter by ID, page or author* over the loaded rows (case-insensitive). */
export function filterRows(rows: readonly ProposalRow[], filter: string) {
  const needle = filter.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) =>
    [row.slug, row.title, row.where, row.author].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}

// ---------- F-10 Review ----------

const short = (hash: string) => hash.slice(0, 8);

export function bindingText(binding: components['schemas']['BindingDto']) {
  return `Bound to bundle ${short(binding.bundleHash)} · artifact ${short(binding.artifactHash)} · preview ${formatTime(new Date(binding.previewAt))} · discussion v${String(binding.discussionVersion)} · dispute v${String(binding.disputeVersion)}`;
}

export function reviewSubline(detail: ProposalDetailDto, now: Date) {
  const kind = detail.submitter.kind === 'agent' ? ' (agent)' : '';
  const relative = age(detail.createdAt, now);
  return {
    proposedBy: `Proposed by ${detail.submitter.name}${kind} ${relative} ago`,
    base: detail.base ? `base ${detail.base.versionLabel}` : 'new page',
  };
}

export type ProposalDiscussionDto = components['schemas']['ProposalDiscussionDto'];
export type DisputeEventDto = components['schemas']['DisputeEventDto'];

export type Banner = {
  tone: 'default' | 'warn' | 'error';
  title: string;
  text: string;
  action: { label: string; href?: string; reload?: true; tab?: 'discussion' };
};

/** The open/reopen entry that started the current dispute. */
function disputeStart(events: readonly DisputeEventDto[]) {
  return [...events].reverse().find(({ action }) => action === 'open' || action === 'reopen');
}

/** F-10 *disputed* banner (D-121): a dispute or an unresolved proposal topic holds approval. */
function heldBanner(
  detail: ProposalDetailDto,
  discussion: ProposalDiscussionDto | undefined,
): Banner | null {
  if (detail.state !== 'pending' || !detail.discussion.disputed) return null;
  const tail = 'You can still ask for changes.';
  if (detail.discussion.disputeOpen) {
    const start = discussion ? disputeStart(discussion.disputes.events) : undefined;
    return {
      tone: 'warn',
      title: 'Held by a dispute.',
      text: start ? `${start.actor.name} disputed it: “${start.reason}” ${tail}` : tail,
      action: { label: 'Go to dispute', tab: 'discussion' },
    };
  }
  const topic = discussion?.topic;
  return {
    tone: 'warn',
    title: 'Held by a discussion.',
    text: topic ? `“${topic.title}” is not resolved yet. ${tail}` : tail,
    action: { label: 'Go to discussion', tab: 'discussion' },
  };
}

export type LockReason = Extract<ErrorCode, 'DISCUSSION_CHANGED' | 'DECISION_BINDING_MISMATCH'>;
export const LOCK_CODES: readonly ErrorCode[] = ['DISCUSSION_CHANGED', 'DECISION_BINDING_MISMATCH'];

/** F-10 status banner for the drawn scenarios (locked, publishing, blocked) plus published. */
export function reviewBanner(
  detail: ProposalDetailDto,
  locked: LockReason | null,
  pageHref: string,
  discussion?: ProposalDiscussionDto,
): Banner | null {
  if (locked)
    return {
      tone: 'error',
      title: locked === 'DISCUSSION_CHANGED' ? 'New discussion entry.' : 'The proposal changed.',
      text: 'Reread before deciding. Your reason is kept.',
      action: { label: 'Reload', reload: true },
    };
  if (detail.tab === 'blocked')
    return {
      tone: 'error',
      title: 'Publish outcome unknown.',
      text: 'The write timed out. Nobody can publish to this page until the owner confirms what was written.',
      action: { label: 'Investigate in Operations', href: '/work/ops' },
    };
  const held = heldBanner(detail, discussion);
  if (held) return held;
  const phase = detail.publication?.phase ?? null;
  if (detail.state === 'approved' && detail.publication?.auto && phase && phase !== 'not_written')
    return {
      tone: 'default',
      title: 'Publishing automatically.',
      text: 'AUTO_PUBLISH is on. The page authors will see it in their weekly summary.',
      action: { label: 'View page', href: pageHref },
    };
  if (detail.state === 'published')
    return {
      tone: 'default',
      title: 'Published.',
      text: detail.publication?.versionLabel
        ? `Version ${detail.publication.versionLabel} is on the page.`
        : 'The change is on the page.',
      action: { label: 'View page', href: pageHref },
    };
  return null;
}

const STEP_LABELS = ['Verified', 'Writing', 'Written', 'Done'] as const;
const currentStep: Partial<Record<PublicationPhase, number>> = {
  prepared: 1,
  writing: 1,
  unknown: 1,
  written: 3,
  done: 4,
};

/** PublishProgress steps (F-10 publishing/blocked): done ✓, current "…", later muted. */
export function publishSteps(phase: PublicationPhase | null): PublishStep[] | null {
  const current = phase ? currentStep[phase] : undefined;
  if (current === undefined) return null;
  return STEP_LABELS.map((label, index) => ({
    label,
    state: index < current ? 'done' : index === current ? 'current' : 'todo',
  }));
}

export type DecisionPanel =
  | { kind: 'decide' }
  | { kind: 'publishing'; text: string; steps: PublishStep[] }
  | { kind: 'note'; text: string; publish?: boolean };

/** What *Your decision* shows for the proposal and the caller. */
export function decisionPanel(detail: ProposalDetailDto, viewerId: string | null): DecisionPanel {
  if (detail.state === 'pending') {
    if (detail.can.decide) return { kind: 'decide' };
    if (viewerId && detail.submitter.id === viewerId)
      return { kind: 'note', text: 'You proposed this change. Someone else decides.' };
    return {
      kind: 'note',
      text: detail.assignment
        ? `Assigned to ${detail.assignment.assignee.name}. You are not assigned to this proposal.`
        : 'Nobody is assigned yet. You are not assigned to this proposal.',
    };
  }
  const decision = detail.decisions[0];
  const by = decision
    ? `${decision.approve ? 'Approved' : 'Sent back'} by ${decision.reviewer.name} at ${formatTime(new Date(decision.createdAt))}.`
    : '';
  const phase = detail.publication?.phase ?? null;
  if (detail.state === 'approved') {
    const steps = publishSteps(phase);
    if (steps) {
      const base = detail.base ? ` if the page is still at ${detail.base.versionLabel}` : '';
      const how = detail.publication?.auto ? 'Publishing automatically' : 'Publishing';
      return { kind: 'publishing', text: `${by} ${how}${base}.`.trim(), steps };
    }
    if (phase === 'not_written')
      return {
        kind: 'note',
        text: `${by} The owner recorded that nothing was written. Waiting to publish again.`,
        publish: detail.can.publish,
      };
    return { kind: 'note', text: `${by} Waiting to be published.`, publish: detail.can.publish };
  }
  if (detail.state === 'published') {
    const steps = publishSteps('done') ?? [];
    return { kind: 'publishing', text: `${by} Published.`.trim(), steps };
  }
  if (detail.state === 'stale')
    return {
      kind: 'note',
      text: `${by} Not published: the page changed after the author read it.`.trim(),
    };
  if (detail.withdrawn) return { kind: 'note', text: `Withdrawn: ${detail.withdrawn.reason}` };
  return { kind: 'note', text: `${by} ${decision?.reason ?? ''}`.trim() };
}

const refRole = { target: ' (target)', source: '', scope: ' (scope)' } as const;

/** *Read by the author* table rows. */
export function refRows(refs: ProposalDetailDto['refs']) {
  return refs.map((ref) => ({
    key: `${ref.role}:${ref.path}`,
    path: `${ref.path}${refRole[ref.role]}`,
    version: ref.versionLabel ?? 'absent',
    now: ref.current ? 'Current' : `Changed · now ${ref.currentVersionLabel ?? 'absent'}`,
  }));
}

const actionText: Record<string, (event: ProposalDetailDto['history'][number]) => string> = {
  'proposal.submitted': (e) => `Submitted by ${e.actor?.name ?? 'system'}`,
  'proposal.assigned': () => 'Assigned for review',
  'proposal.decided': (e) =>
    `${e.data['approve'] === true ? 'Approved' : 'Sent back'} by ${e.actor?.name ?? 'system'}`,
  'proposal.withdrawn': (e) => `Withdrawn by ${e.actor?.name ?? 'the author'}`,
  'publication.queued': () => 'Publish queued',
  'publication.prepared': () => 'Publish prepared',
  'publication.writing': () => 'Writing the page',
  'publication.written': () => 'Written',
  'publication.unknown': () => 'Publish outcome unknown; the page is blocked',
  'publication.stale': () => 'Not published: the page changed',
  'proposal.published': (e) =>
    `Published${typeof e.data['versionLabel'] === 'string' ? ` as ${e.data['versionLabel']}` : ''}${e.data['auto'] === true ? ' automatically' : ''}`,
  'publication.resolved': (e) =>
    `Owner recorded ${e.data['outcome'] === 'written' ? 'the new version on disk' : 'nothing written'}`,
  'proposal.conflict_resolved': (e) =>
    `Conflict resolved by ${e.actor?.name ?? 'system'}${typeof e.data['replacementSlug'] === 'string' ? `; new proposal ${e.data['replacementSlug']}` : ''}`,
  'proposal.discussion_opened': (e) => `Discussion opened by ${e.actor?.name ?? 'system'}`,
  'proposal.discussion_closed': (e) =>
    `Discussion closed${typeof e.data['outcome'] === 'string' ? ` as ${e.data['outcome'].replace('_', ' ')}` : ''} by ${e.actor?.name ?? 'system'}`,
  'proposal.discussion_reopened': (e) => `Discussion reopened by ${e.actor?.name ?? 'system'}`,
  'dispute.open': (e) => `Dispute opened by ${e.actor?.name ?? 'system'}`,
  'dispute.comment': (e) => `Dispute entry by ${e.actor?.name ?? 'system'}`,
  'dispute.resolve': (e) => `Dispute resolved by ${e.actor?.name ?? 'system'}`,
  'dispute.reopen': (e) => `Dispute reopened by ${e.actor?.name ?? 'system'}`,
  'proposal.returned': () => 'Returned to the reviewer after the discussion',
};

/** History tab rows; actions the web does not know yet are shown by their name. */
export function historyRows(history: ProposalDetailDto['history']) {
  return history.map((event) => ({
    key: event.id,
    time: formatTime(new Date(event.at)),
    at: event.at,
    text: actionText[event.action]?.(event) ?? event.action,
  }));
}

/** Body of an artifact as readers see it (status block stripped). */
export function readerBody(markdown: string) {
  return parseStatusBlock(markdown).body;
}

export type ReviewDiff = { heading: string; rows: DiffRow[] };

/**
 * F-10 *Changes*: changed lines with `context` unchanged lines around them; longer unchanged runs
 * collapse into one "N unchanged lines" row.
 */
export function reviewDiff(
  diff: ProposalDiffDto,
  sectionTitle: string | null,
  context = 2,
): ReviewDiff {
  const { lines } = diff;
  const near = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (
      let i = Math.max(0, index - context);
      i <= Math.min(lines.length - 1, index + context);
      i++
    )
      near[i] = true;
  });
  const rows: DiffRow[] = [];
  let hidden = 0;
  const flush = () => {
    if (hidden) rows.push({ kind: 'gap', number: null, text: unchanged(hidden) });
    hidden = 0;
  };
  lines.forEach((line, index) => {
    if (line.kind === 'same' && !near[index]) {
      hidden++;
      return;
    }
    flush();
    rows.push({
      kind: line.kind,
      number: line.kind === 'del' ? line.oldLine : line.newLine,
      text: line.text,
    });
  });
  // A diff without changes has no rows (DiffView shows its empty text).
  if (rows.length) flush();
  const { added, removed } = diff.stats;
  const parts = [
    added ? `${String(added)} ${added === 1 ? 'line' : 'lines'} added` : null,
    removed ? `${String(removed)} ${removed === 1 ? 'line' : 'lines'} removed` : null,
  ].filter(Boolean);
  const where = sectionTitle ? `Section ${sectionTitle}` : 'Whole page';
  return { heading: `${where} · ${parts.length ? parts.join(', ') : 'no changes'}`, rows };
}

function unchanged(n: number) {
  return `${String(n)} unchanged ${n === 1 ? 'line' : 'lines'}`;
}

export function reasonStorageKey(slug: string) {
  return `mw:form:review:${slug}`;
}

/** `proposalStatus` input from a detail (latest publication = `publication`). */
export function detailStatusInput(detail: ProposalDetailDto) {
  return {
    state: detail.state,
    tab: detail.tab,
    phase: detail.publication?.phase ?? null,
    withdrawn: detail.withdrawn !== null,
    conflict: detail.conflict !== null,
    updatedAt: detail.publication?.updatedAt ?? detail.createdAt,
    publishedVersion: detail.publication?.versionLabel ?? null,
    autoPublished: detail.publication?.auto ?? null,
    disputed: detail.discussion.disputed,
  };
}

// ---------- F-10 discussion (P6-06) ----------

export type DisputeAction = 'open' | 'reopen' | 'comment';

/** What *Hold for discussion* writes to the dispute log (system-logic §7.5.2 `disputeStep`). */
export function holdAction(summary: ProposalDetailDto['discussion']): DisputeAction {
  if (summary.disputeOpen) return 'comment';
  return summary.disputeVersion > 0 ? 'reopen' : 'open';
}

const holdSubmit: Record<DisputeAction, string> = {
  open: 'Open dispute',
  reopen: 'Reopen dispute',
  comment: 'Add to dispute',
};

export type DecisionChoice = 'approve' | 'changes' | 'hold';

/** F-10 *Your decision* choices; *Hold for discussion* only for the dispute writer (D-122). */
export function decisionChoices(detail: ProposalDetailDto) {
  return [
    {
      value: 'approve' as const,
      label: 'Approve and publish',
      description: 'published at once',
      submit: 'Approve and publish',
    },
    {
      value: 'changes' as const,
      label: 'Request changes',
      description: 'back to the author with your reason',
      submit: 'Send back with reason',
    },
    {
      value: 'hold' as const,
      label: 'Hold for discussion',
      description: 'opens a dispute on the section',
      submit: holdSubmit[holdAction(detail.discussion)],
    },
  ];
}

/** Submit button of *Your decision*: locked → reread; approve while disputed → held (F-10). */
export function submitState(
  choice: DecisionChoice,
  detail: ProposalDetailDto,
  locked: LockReason | null,
) {
  const current = decisionChoices(detail).find(({ value }) => value === choice);
  if (locked) return { label: 'Reread before deciding', disabled: true };
  if (choice === 'approve' && detail.discussion.disputed)
    return { label: 'Approval held by dispute', disabled: true };
  return { label: current?.submit ?? 'Approve and publish', disabled: !detail.preview };
}

export type SeenVersions = { discussionVersion: number; disputeVersion: number };

export function seenVersions(detail: ProposalDetailDto): SeenVersions {
  const { discussionVersion, disputeVersion } = detail.discussion;
  return { discussionVersion, disputeVersion };
}

/**
 * A new discussion or dispute entry arrived (SSE refetch) since the reviewer last read: lock the
 * decision until *Reload* (ux.md §10 "decision locked until reread"); own writes move `seen`.
 */
export function versionsChanged(seen: SeenVersions, detail: ProposalDetailDto) {
  if (detail.state !== 'pending' || !detail.can.decide) return false;
  return (
    seen.discussionVersion !== detail.discussion.discussionVersion ||
    seen.disputeVersion !== detail.discussion.disputeVersion
  );
}

/** *Discussion (n)*: the proposal topic and the dispute log count as one entry each. */
export function discussionCount(discussion: ProposalDiscussionDto | undefined) {
  if (!discussion) return undefined;
  return (discussion.topic ? 1 : 0) + (discussion.disputes.events.length ? 1 : 0);
}

export const RESOLUTION_KINDS = [
  ['supported', 'Supported by the sources'],
  ['scoped', 'Scoped to where it holds'],
  ['attributed', 'Attributed to its source'],
  ['not_a_conflict', 'Not a conflict'],
] as const;

const disputeVerb: Record<DisputeEventDto['action'], string> = {
  open: 'opened the dispute',
  comment: 'added',
  resolve: 'resolved the dispute',
  reopen: 'reopened the dispute',
};

/** Dispute log rows (append-only, `seq` order). */
export function disputeRows(events: readonly DisputeEventDto[]) {
  return events.map((event) => {
    const kind = RESOLUTION_KINDS.find(([id]) => id === event.resolutionKind)?.[1];
    const related = event.relatedSlugs.length ? ` Related: ${event.relatedSlugs.join(', ')}.` : '';
    return {
      key: String(event.seq),
      time: formatTime(new Date(event.createdAt)),
      at: event.createdAt,
      who: event.actor.name,
      text: `${disputeVerb[event.action]}${kind ? ` (${kind.toLowerCase()})` : ''}: ${event.reason}${related}`,
    };
  });
}
