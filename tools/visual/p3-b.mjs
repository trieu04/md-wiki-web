const searchPath = '/search?q=pinhole+size';
const searchReady = (count) => `main [role="status"]:has-text("showing ${count} best")`;
const trustFilters = ['Checked against source', 'Reviewed', 'Not reviewed', 'Confirmed error'];
const cases = [
  {
    frame: 'Main',
    variant: 'all',
    path: '/',
    phase3: true,
    fixedTime: '2026-11-23T12:00:00Z',
    ready: '#recent tbody tr:last-child',
  },
  { frame: 'Search', variant: 'relevance', path: searchPath, phase3: true, ready: searchReady(5) },
];

for (const [variant, label, first] of [
  ['trust', 'Most checked first', 'Pinhole alignment'],
  ['recent', 'Newest', 'Point spread function'],
]) {
  cases.push({
    frame: 'Search',
    variant,
    path: searchPath,
    phase3: true,
    ready: `article:first-child a:has-text("${first}")`,
    async prepare(page) {
      await page.locator(searchReady(5)).waitFor();
      await page.getByRole('button', { name: label, exact: true }).click();
    },
  });
}

for (const [variant, off, count] of [
  ['without-checked', [0], 3],
  ['without-reviewed', [1], 4],
  ['without-not-reviewed', [2], 4],
  ['without-error', [3], 5],
  ['all-filters-off', [0, 1, 2, 3], 1],
]) {
  cases.push({
    frame: 'Search',
    variant,
    path: searchPath,
    phase3: true,
    ready: searchReady(count),
    async prepare(page) {
      await page.locator(searchReady(5)).waitFor();
      for (const index of off) {
        await page
          .getByRole('checkbox', { name: new RegExp(`^${trustFilters[index]}`, 'u') })
          .uncheck();
      }
    },
  });
}

export default cases;
