import type { components, operations } from '@md-wiki/contracts';
import { formatDate, LABEL_ORDER, labelMeta } from '@md-wiki/domain';
import type { Label } from '@md-wiki/domain';
import { wikiPageHref } from '../navigation/model';

export type SearchResponse = components['schemas']['SearchDto'];
type Hit = components['schemas']['SearchHitDto'];
type Topic = components['schemas']['TopicFacetDto'];
export type SearchRequest = operations['WikiReadController_search']['parameters']['query'];
export const sorts = [
  ['relevance', 'Best match'],
  ['trust', 'Most checked first'],
  ['recent', 'Newest'],
] as const;
export const updatedWindows = [
  ['any', 'Any time'],
  ['30d', 'Last 30 days'],
  ['1y', 'Last year'],
] as const;
// F-02 has no checkbox for recheck; the API owns which hits survive filtering.
export const trustOptions = LABEL_ORDER.filter((label) => label !== 'recheck');

type Filters = {
  sort: NonNullable<SearchRequest['sort']>;
  updated: NonNullable<SearchRequest['updated']>;
  labels: readonly Label[];
  topics: readonly Topic[];
};
export const defaultFilters: Filters = {
  sort: 'relevance',
  updated: 'any',
  labels: trustOptions,
  topics: [],
};

export function toggleTrust(filters: Filters, label: Label): Filters {
  return {
    ...filters,
    labels: trustOptions.filter((option) => filters.labels.includes(option) !== (option === label)),
  };
}

export function toggleTopic(filters: Filters, topic: Topic): Filters {
  return {
    ...filters,
    topics: filters.topics.some(({ id }) => id === topic.id)
      ? filters.topics.filter(({ id }) => id !== topic.id)
      : [...filters.topics, topic],
  };
}

export function searchRequest(q: string, filters: Filters): SearchRequest {
  return {
    q: q.trim(),
    sort: filters.sort,
    updated: filters.updated,
    // No values means unrestricted on the wire. Explicitly select recheck when all boxes are off.
    ...(filters.labels.length !== trustOptions.length && {
      'labels[]': filters.labels.length ? [...filters.labels] : ['recheck'],
    }),
    ...(filters.topics.length > 0 && { 'topics[]': filters.topics.map(({ id }) => id).sort() }),
  };
}

export function topicOptions(facets: Topic[] = [], selected: readonly Topic[]) {
  const present = new Set(facets.map(({ id }) => id));
  return [
    ...facets,
    ...selected.filter(({ id }) => !present.has(id)).map((topic) => ({ ...topic, n: 0 })),
  ];
}

function hitMeta({ label, meta }: Hit) {
  const format = (value: string) => formatDate(new Date(value));
  const updated = `updated ${format(meta.updatedAt)}`;
  switch (label.label) {
    case 'checked':
      return meta.sourceName
        ? `Checked against ${meta.sourceName}${meta.checkedBy ? ` by ${String(meta.checkedBy)} ${meta.checkedBy === 1 ? 'person' : 'people'}` : ''} · ${updated}`
        : `${labelMeta.checked} · ${updated}`;
    case 'reviewed':
      return `Reviewed${label.since ? ` ${format(label.since)}` : ''} · not yet checked against a source`;
    case 'not_reviewed':
      return labelMeta.not_reviewed;
    default:
      return `Updated ${format(meta.updatedAt)}`;
  }
}

export function searchModel({ total, pageCount, items }: SearchResponse) {
  const hits = items.map((hit) => {
    const { path, pageTitle, sectionTitle, anchor, label, snippet } = hit;
    const warning =
      label.label === 'recheck' || label.label === 'error'
        ? {
            text:
              label.reason ||
              (label.label === 'error'
                ? 'Known to be wrong. Don’t rely on it until it is fixed.'
                : 'Use with care.'),
            kind: label.label,
          }
        : null;
    return {
      href: wikiPageHref(path, anchor),
      pageTitle,
      sectionTitle,
      label: label.label,
      snippet,
      warning,
      meta: hitMeta(hit),
    };
  });
  return {
    countLine: `${String(total)} ${total === 1 ? 'section' : 'sections'} in ${String(pageCount)} ${pageCount === 1 ? 'page' : 'pages'} · showing ${String(hits.length)} best matches`,
    hits,
  };
}
