import { expect, test } from 'vitest';
import { frameSamples } from './samples';

test('Search keeps the frame totals and facet counts separate from the five displayed hits', () => {
  const search = frameSamples.Search;
  expect(Object.keys(search).sort()).toEqual([
    'facets',
    'items',
    'nextCursor',
    'pageCount',
    'total',
  ]);
  expect(search.total).toBe(35);
  expect(search.pageCount).toBe(14);
  expect(search.items).toHaveLength(5);
  expect(search.nextCursor).toBeNull();
  expect(search.facets.labels).toEqual({
    checked: 12,
    reviewed: 18,
    not_reviewed: 3,
    recheck: 2,
    error: 0,
  });
  expect(search.facets.topics.map(({ name, n }) => [name, n])).toEqual([
    ['Microscopy techniques', 21],
    ['Protocols', 9],
    ['Instruments and booking', 3],
    ['Image processing', 2],
  ]);
});

test('Search keeps the exact snippet, warning and reference orders', () => {
  const { items } = frameSamples.Search;
  expect(items.map(({ sectionTitle }) => sectionTitle)).toEqual([
    'Principle',
    'Choosing the size',
    'Resolution',
    'FWHM',
    'Pinhole crosstalk',
  ]);
  expect(
    [...items]
      .sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt))
      .map(({ sectionTitle }) => sectionTitle),
  ).toEqual(['FWHM', 'Principle', 'Resolution', 'Choosing the size', 'Pinhole crosstalk']);
  expect(items[0]?.snippet).toEqual([
    {
      before: 'Emitted fluorescence returns to a point detector. Closing the ',
      hit: 'pinhole',
      after: ' improves sectioning and reduces the detected signal.',
    },
  ]);
  expect(items[0]?.label.reason).toBe(
    'Under re-check since 22 Nov: reported as outdated, confirmed by a page author. A fix is being reviewed.',
  );
});

test('Review carries the discussion and dispute versions shown in each scenario', () => {
  expect(
    Object.fromEntries(
      Object.entries(frameSamples.Review.S).map(
        ([scenario, { discussionVersion, disputeVersion }]) => [
          scenario,
          [discussionVersion, disputeVersion],
        ],
      ),
    ),
  ).toEqual({
    escalated: [1, 0],
    disputed: [1, 1],
    locked: [2, 0],
    publishing: [1, 0],
    blocked: [1, 0],
  });
});
