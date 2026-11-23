// Phase 5 screens (P5-C/P5-D): F-09 tabs, F-10 publishing/blocked, F-07 choices, F-13.
// Regions without Phase 5 data are not rendered (D-97, D-98, D-100), so whole-screen
// mismatch percentages are diagnostic only; compare the drawn regions per state.
export default [
  ...['open', 'stale', 'blocked', 'published', 'rejected', 'all'].map((tab) => ({
    frame: 'Proposals',
    variant: tab,
    path: `/work/proposals?tab=${tab}`,
    ready: 'table[aria-label="Proposals"]',
  })),
  {
    frame: 'Review',
    variant: 'publishing',
    path: '/work/proposals/fix-pinhole-units?scenario=publishing',
    ready: 'text=Publishing automatically.',
  },
  {
    frame: 'Review',
    variant: 'blocked',
    path: '/work/proposals/deconv-iterations',
    ready: 'text=Publish outcome unknown.',
  },
  ...['merge', 'mine', 'drop'].map((choice) => ({
    frame: 'Conflict',
    variant: choice,
    path: '/me/suggestions/detector-table/resolve',
    ready: 'text=What do you want to do?',
    async prepare(page) {
      const label = { merge: /^Combine both/u, mine: /^Replace with mine/u, drop: /^Drop my change/u };
      await page.getByRole('radio', { name: label[choice] }).check({ force: true });
    },
  })),
  {
    frame: 'Ops',
    variant: 'default',
    path: '/work/ops',
    ready: 'text=Blocked: publish outcome unknown',
  },
];
