import type { components } from '@md-wiki/contracts';
import { formatRelative, labelMeta } from '@md-wiki/domain';
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

export function recentRows(recent: Recent, labels: ReadonlyMap<string, Label>, now: Date) {
  return recent.items.map(({ path, pageTitle, versionLabel, at }) => ({
    path,
    pageTitle,
    key: JSON.stringify([path, versionLabel]),
    label: labels.get(path),
    timestamp: at,
    when: formatRelative(new Date(at), now),
  }));
}
