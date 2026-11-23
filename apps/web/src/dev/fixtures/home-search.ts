import { LABEL_ORDER, matchesLabelSelection, pageLabel } from '@md-wiki/domain';
import type { Label } from '@md-wiki/domain';
import type { Recent, Tree } from '../../features/home/model';
import type { SearchResponse } from '../../features/search/model';
import { frameSamples } from './samples';

export const homeDescription =
  'How we run the microscopes, prepare samples and process images. Every section shows how well it has been checked, so you know what you can rely on.';
export const visualNow = '2026-11-23T12:00:00Z';
const paths = [
  'point-spread-function.md',
  'confocal-microscopy.md',
  'light-sheet-microscopy.md',
  'sted-microscopy.md',
  'pinhole-alignment.md',
  'sample-mounting.md',
];
const labels: Label[] = ['reviewed', 'reviewed', 'reviewed', 'not_reviewed', 'checked', 'reviewed'];
const ages = [3, 5, 5, 24, 48, 72];
function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Incomplete Home frame fixture');
  return item;
}

export const visualRecent: Recent = {
  items: frameSamples.Main.allRecent.map(({ page }, index) => ({
    path: itemAt(paths, index),
    pageTitle: page,
    at: new Date(Date.parse(visualNow) - itemAt(ages, index) * 3_600_000).toISOString(),
    versionLabel: '20261123',
    changedOutsideReview: false,
    proposalSlug: null,
    sectionTitle: null,
    summary: null,
  })),
  nextCursor: null,
};

function sectionSpread(labels: Label[]) {
  return pageLabel(
    labels.map((label) => ({ label, since: null, reviewerKind: null, reason: null })),
  );
}

// The frame gives aggregates, not the remaining page names or exact section counts.
// Use anonymous fixture-only pages to make the wire tree add up to those aggregates.
const counts = { checked: 427, reviewed: 479, not_reviewed: 105, recheck: 31, error: 0 };
for (const label of labels) counts[label]--;
const undisplayed = LABEL_ORDER.flatMap((label) => Array<Label>(counts[label]).fill(label));
let largerPages =
  undisplayed.length % (frameSamples.Main.topics.reduce((sum, { n }) => sum + n, 0) - paths.length);
const topicIds = [
  'microscopy-techniques',
  'image-processing',
  'sample-preparation',
  'instruments-and-booking',
  'protocols',
];
const topicPages = [[1, 2, 3], [0], [5], [], [4]];
export const visualTree: Tree = {
  topics: frameSamples.Main.topics.map(({ name, n }, index) => {
    const id = itemAt(topicIds, index);
    const pages = itemAt(topicPages, index).map((pageIndex) => {
      const { path, pageTitle: title, at: updatedAt } = itemAt(visualRecent.items, pageIndex);
      return { path, title, updatedAt, pageLabel: sectionSpread([itemAt(labels, pageIndex)]) };
    });
    const extras = Array.from({ length: n - pages.length }, (_, index) => ({
      path: `${id}/sample-${String(index + 1)}.md`,
      title: `Sample ${String(index + 1)}`,
      updatedAt: visualNow,
      pageLabel: sectionSpread(undisplayed.splice(0, 8 + Number(largerPages-- > 0))),
    }));
    return { id, name, pageCount: n, pages: [...pages, ...extras] };
  }),
};

export function visualSearch(params: URLSearchParams): SearchResponse {
  const { facets, items, total, pageCount } = frameSamples.Search;
  const q = params.get('q')?.trim().toLowerCase();
  const selected = new Set(params.getAll('labels[]') as Label[]);
  const topics = params.getAll('topics[]');
  const updated = params.get('updated');
  const since =
    updated === '30d' || updated === '1y'
      ? Date.parse(visualNow) - (updated === '30d' ? 30 : 365) * 86_400_000
      : -Infinity;
  const base =
    q === 'pinhole size' ? items.filter((hit) => Date.parse(hit.meta.updatedAt) >= since) : [];
  const filtered = base.filter(({ label, path }) => {
    const topic =
      path === 'pinhole-alignment.md'
        ? 'protocols'
        : path === 'point-spread-function.md'
          ? 'image-processing'
          : 'microscopy-techniques';
    return (
      matchesLabelSelection(label.label, selected) && (!topics.length || topics.includes(topic))
    );
  });
  const sort = params.get('sort');
  if (sort === 'trust')
    filtered.sort(
      (a, b) => LABEL_ORDER.indexOf(a.label.label) - LABEL_ORDER.indexOf(b.label.label),
    );
  if (sort === 'recent') filtered.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
  return {
    // Like the frame, the headline/facets describe all matching data while these
    // variants only have the visible preview hits available.
    total: q === 'pinhole size' ? total : 0,
    pageCount: q === 'pinhole size' ? pageCount : 0,
    facets: q === 'pinhole size' ? facets : { labels: sectionSpread([]).spread, topics: [] },
    items: filtered.map((hit) =>
      hit.meta.sourceName === 'LSM 980 manual'
        ? { ...hit, meta: { ...hit.meta, sourceName: 'the LSM 980 manual' } }
        : hit,
    ),
    nextCursor: null,
  };
}
