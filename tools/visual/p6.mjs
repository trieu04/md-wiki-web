// Phase 6 screens (P6-04…06): F-11 filters and the F-10 disputed scenario. Dispute logs are not
// topics (D-118), so F-11's "Is the claim general?" row is absent; scores are diagnostic only.
export default [
  ...['open', 'mine', 'closed', 'all'].map((filter) => ({
    frame: 'Discussions',
    variant: filter,
    path: `/work/discussions?filter=${filter}`,
    ready: 'section[aria-label="Thread"] h2',
  })),
  {
    frame: 'Review',
    variant: 'disputed',
    path: '/work/proposals/fix-pinhole-units?scenario=disputed',
    ready: 'text=Held by a dispute.',
  },
];
