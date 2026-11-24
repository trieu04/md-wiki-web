import type { components } from '@md-wiki/contracts';
import { formatDate, labelMeta, type Label } from '@md-wiki/domain';

type S = components['schemas'];
export type QueueItemDto = S['QueueItemDto'];
export type QueueItemDetailDto = S['QueueItemDetailDto'];
export type CredibilityQueueDto = S['CredibilityQueueDto'];
export type CredibilityPagesDto = S['CredibilityPagesDto'];
export type CredibilitySourceDto = S['CredibilitySourceDto'];
export type QueueType = QueueItemDto['type'];

export const CREDIBILITY_TABS = [
  { id: 'queue', label: 'Needs a person' },
  { id: 'coverage', label: 'Pages' },
  { id: 'sources', label: 'Sources' },
] as const;
export type CredibilityTab = (typeof CREDIBILITY_TABS)[number]['id'];
export function credibilityTab(value: unknown): CredibilityTab {
  return CREDIBILITY_TABS.some(({ id }) => id === value) ? (value as CredibilityTab) : 'queue';
}

const ORDER: readonly Label[] = ['checked', 'reviewed', 'recheck', 'error', 'not_reviewed'];

/** The five label tiles over every current section (F-12 header, §7.7.8). */
export function statTiles(tiles: CredibilityPagesDto['tiles']) {
  const total = ORDER.reduce((sum, label) => sum + tiles[label].sections, 0);
  return ORDER.map((label) => {
    const { sections, changeThisWeek } = tiles[label];
    const pct = total ? Math.round((sections / total) * 100) : 0;
    const delta =
      label === 'error'
        ? sections
          ? 'Readers see a warning'
          : 'None'
        : changeThisWeek
          ? `${String(pct)}% · ${changeThisWeek > 0 ? '+' : ''}${String(changeThisWeek)} this week`
          : `${String(pct)}%`;
    return { label, title: labelMeta[label], n: String(sections), delta };
  });
}

const where = (section: QueueItemDto['section']) =>
  section ? [section.pageTitle, section.sectionTitle].filter(Boolean).join(' › ') : 'Whole wiki';

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

export function reachText(reach: QueueItemDto['reach']) {
  const parts = [`Linked from ${plural(reach.linkedFrom, 'page')}`];
  if (reach.teams) parts.push(`used by ${plural(reach.teams, 'team')}`);
  return parts.join(' · ');
}

export function queueRow(item: QueueItemDto) {
  return {
    key: `${item.type}:${item.id}`,
    type: item.type,
    id: item.id,
    kind: item.title,
    where: where(item.section),
    reach: reachText(item.reach),
    label: item.section?.label.label ?? 'not_reviewed',
    // Candidates come from the 7b jobs (models or similarity), not from people.
    ai: item.type === 'candidate',
    blocking: item.blocking,
  };
}

const OUTCOMES: Record<string, { label: string; hint: string }> = {
  confirm: {
    label: 'Confirm',
    hint: 'Section goes under re-check for everyone; the reporter is told',
  },
  confirm_error: {
    label: 'Wrong: mark as confirmed error',
    hint: 'Readers see a red warning until someone fixes it',
  },
  dismiss: { label: 'Dismiss with a reason', hint: 'The reporter sees your reason and can reply' },
  still_correct: {
    label: 'Still correct',
    hint: 'Record why; the section goes back to its earlier label',
  },
  keep_recheck: { label: 'Keep under re-check', hint: 'Needs more work; stays on this list' },
  yes: { label: 'Yes, confirm the link', hint: 'Records the link between the two sections' },
  no: { label: 'No', hint: 'The pair is not suggested again' },
  ask_authors: { label: 'Not sure, ask the authors', hint: 'Opens a discussion' },
};

const DECIDE_TITLE: Record<QueueType, string> = {
  report: 'Confirm or dismiss the report',
  retraction: 'Decide what readers should see',
  flag: 'Decide what readers should see',
  candidate: 'Is this right?',
  pair: 'For information',
  fix: 'Close when the fix is published',
};

export function detailModel(item: QueueItemDetailDto) {
  return {
    ...queueRow(item),
    why: item.why,
    properties: item.properties,
    downstream: item.downstream.map((section) => ({
      key: `${section.path}#${section.anchor}`,
      text: where(section),
      href: `/wiki/${section.path.split('/').map(encodeURIComponent).join('/')}#${encodeURIComponent(section.anchor)}`,
      label: section.label.label,
    })),
    decisions: item.decisions.map((decision) => ({
      key: `${decision.at}:${decision.outcome}`,
      text: `${OUTCOMES[decision.outcome]?.label ?? decision.outcome} — ${decision.actor.name}, ${formatDate(new Date(decision.at))}`,
      reason: decision.reason,
    })),
    decideTitle: DECIDE_TITLE[item.type],
    outcomes: item.outcomes.map((value) => ({
      value,
      label: OUTCOMES[value]?.label ?? value,
      description: OUTCOMES[value]?.hint ?? '',
    })),
    canDecide: item.can.decide && item.outcomes.length > 0,
    // `fix` items link to Review (§7.7.8); the pending proposal list is where the fix is.
    reviewHref: item.type === 'fix' ? '/work/proposals' : null,
  };
}

export function decisionInput(
  item: Pick<QueueItemDto, 'type' | 'id' | 'outcomes'>,
  outcome: string | null,
  reason: string,
):
  | { ok: true; input: S['CredibilityDecisionInput'] }
  | { ok: false; errors: { outcome?: string; reason?: string } } {
  const trimmed = reason.trim();
  const errors: { outcome?: string; reason?: string } = {};
  if (!outcome || !item.outcomes.includes(outcome))
    errors.outcome = 'Choose what readers should see.';
  if (!trimmed) errors.reason = 'Give a reason. It is shown in the section’s evidence.';
  else if (trimmed.length > 4000) errors.reason = 'Use at most 4000 characters.';
  if (errors.outcome || errors.reason) return { ok: false, errors };
  return {
    ok: true,
    input: { type: item.type, id: item.id, outcome: outcome ?? '', reason: trimmed },
  };
}

export function coverageRow(page: CredibilityPagesDto['items'][number]) {
  const { spread } = page.pageLabel;
  const count = ORDER.reduce((sum, label) => sum + spread[label], 0);
  return {
    key: page.path,
    page: page.title,
    href: `/wiki/${page.path.split('/').map(encodeURIComponent).join('/')}`,
    label: page.pageLabel.label,
    spread,
    ariaLabel: `${plural(count, 'section')}: ${ORDER.filter((label) => spread[label])
      .map((label) => `${String(spread[label])} ${labelMeta[label].toLowerCase()}`)
      .join(', ')}`,
    oldest: page.oldestUnchecked
      ? `${page.oldestUnchecked.title}${page.oldestUnchecked.since ? ` (${formatDate(new Date(page.oldestUnchecked.since))})` : ''}`
      : 'None',
    readers: String(page.activeReaders30d),
  };
}

const SOURCE_STATE: Record<CredibilitySourceDto['state'], string> = {
  retracted: 'Retracted',
  changed: 'Changed since cited',
  archived: 'OK · archived copy',
  unchecked: 'Not checked yet',
  ok: 'OK',
};
const TIER: Record<'high' | 'medium' | 'low', string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function sourceRow(source: CredibilitySourceDto) {
  return {
    key: source.ref,
    source: source.name ?? source.ref.replace(/^(doi|url):/, ''),
    ref: source.ref,
    tier: source.tier ? TIER[source.tier] : 'No tier',
    status: SOURCE_STATE[source.state],
    tone: (source.state === 'retracted'
      ? 'error'
      : source.state === 'changed'
        ? 'reviewed'
        : source.state === 'unchecked'
          ? 'not_reviewed'
          : 'checked') as Label,
    cited: plural(source.citedBy, 'section'),
    checked: source.lastCheck
      ? `${source.lastCheck.result}, ${formatDate(new Date(source.lastCheck.at))}`
      : 'Never',
  };
}
