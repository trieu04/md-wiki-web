import { expect, it } from 'vitest';
import { visualNow, visualRecent, visualTree } from '../src/dev/fixtures/home-search';
import { homeTreeModel, recentRows } from '../src/features/home/model';

it('counts sections from the tree (not pages), and uses the API topic order and counts', () => {
  const model = homeTreeModel(visualTree);
  expect(model.topics.map(({ name, pageCount }) => [name, pageCount])).toEqual([
    ['Microscopy techniques', 24],
    ['Image processing', 31],
    ['Sample preparation', 18],
    ['Instruments and booking', 22],
    ['Protocols', 33],
  ]);
  expect(model.distribution).toMatchObject({
    title: 'Across the wiki · 1,042 sections',
    caption: '41% checked · 46% reviewed · 3% under re-check · 10% not reviewed',
    ariaLabel: '41% checked against source, 46% reviewed, 3% under re-check, 10% not reviewed',
    spread: { checked: 427, reviewed: 479, not_reviewed: 105, recheck: 31, error: 0 },
  });
});

it('does not divide by zero, invent a page destination, or invent trust for a missing tree path', () => {
  const model = homeTreeModel({
    topics: [{ id: 'empty', name: 'Empty', pageCount: 0, pages: [] }],
  });
  expect(model.distribution).toBeNull();
  expect(model.topics[0]?.firstPage).toBeUndefined();
  expect(recentRows(visualRecent, model.pageLabels, new Date(visualNow))[0]?.label).toBeUndefined();
  expect(
    recentRows({ items: [], nextCursor: null }, model.pageLabels, new Date(visualNow)),
  ).toEqual([]);
});

it('joins recent snapshots to current page labels by exact path and uses shared relative time', () => {
  const rows = recentRows(visualRecent, homeTreeModel(visualTree).pageLabels, new Date(visualNow));
  expect(rows.map(({ pageTitle, label, when }) => [pageTitle, label, when])).toEqual([
    ['Point spread function', 'reviewed', '3 h ago'],
    ['Confocal microscopy', 'reviewed', '5 h ago'],
    ['Light-sheet microscopy', 'reviewed', '5 h ago'],
    ['STED microscopy', 'not_reviewed', '1 d ago'],
    ['Pinhole alignment', 'checked', '2 d ago'],
    ['Sample mounting', 'reviewed', '3 d ago'],
  ]);
});
