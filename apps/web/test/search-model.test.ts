import { matchesLabelSelection } from '@md-wiki/domain';
import { expect, it } from 'vitest';
import { visualSearch } from '../src/dev/fixtures/home-search';
import {
  defaultFilters,
  searchModel,
  searchRequest,
  toggleTopic,
  toggleTrust,
  topicOptions,
  trustOptions,
} from '../src/features/search/model';

it('serializes all supported controls without widening an all-off trust selection', () => {
  expect(searchRequest('  & | ! :*  ', defaultFilters)).toEqual({
    q: '& | ! :*',
    sort: 'relevance',
    updated: 'any',
  });
  const off = trustOptions.reduce(toggleTrust, defaultFilters);
  const query = searchRequest('pinhole size', { ...off, sort: 'recent', updated: '30d' });
  expect(query).toEqual({
    q: 'pinhole size',
    sort: 'recent',
    updated: '30d',
    'labels[]': ['recheck'],
  });
  expect(matchesLabelSelection('recheck', new Set(query['labels[]']))).toBe(true);
  expect(searchRequest('   ', defaultFilters).q).toBe('');
});

it('uses the F-02 count-line copy when only the recheck result remains', () => {
  const response = visualSearch(new URLSearchParams({ q: 'pinhole size', 'labels[]': 'recheck' }));
  expect(searchModel(response).countLine).toBe('35 sections in 14 pages · showing 1 best matches');
});

it('keeps a selected topic operable even when the filtered facets omit it', () => {
  const topic = { id: 'test topic', name: 'Test', n: 10 };
  const picked = toggleTopic(defaultFilters, topic);
  expect(searchRequest('wiki', picked)['topics[]']).toEqual(['test topic']);
  expect(topicOptions([], picked.topics)).toEqual([{ ...topic, n: 0 }]);
  expect(toggleTopic(picked, topic)).toEqual(defaultFilters);
});

it('keeps server order, preserves plain snippet fragments and anchors, and derives warning and supported meta', () => {
  const response = visualSearch(new URLSearchParams({ q: 'pinhole size', sort: 'recent' }));
  const model = searchModel(response);
  expect(model.countLine).toBe('35 sections in 14 pages · showing 5 best matches');
  expect(model.hits.map((hit) => hit.sectionTitle)).toEqual([
    'FWHM',
    'Principle',
    'Resolution',
    'Choosing the size',
    'Pinhole crosstalk',
  ]);
  expect(model.hits[1]).toMatchObject({
    href: '/wiki/confocal-microscopy.md#principle',
    warning: { kind: 'recheck' },
    snippet: response.items[1]?.snippet,
    meta: 'Updated 20 Nov',
  });
  expect(model.hits[3]?.meta).toBe(
    'Checked against the LSM 980 manual by 2 people · updated 12 Nov',
  );
  expect(model.hits[4]?.meta).toBe('Not reviewed');
  const first = response.items[0];
  if (!first) throw new Error('Fixture is missing the first hit');
  const error = { ...first, label: { ...first.label, label: 'error' as const, reason: null } };
  expect(searchModel({ ...response, items: [error] }).hits[0]?.warning?.text).toBe(
    'Known to be wrong. Don’t rely on it until it is fixed.',
  );
});
