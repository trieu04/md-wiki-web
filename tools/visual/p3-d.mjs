// F-14 Settings tabs implemented in P3-D. The derived management sections below the
// drawn rows (user table and forms, token form) are not in the frame and show up as
// extra height in the diff; the drawn rows are the comparable region.
export default [
  {
    frame: 'Settings',
    variant: 'people',
    path: '/work/settings?tab=people',
    ready: 'text=Imaging core, Light-sheet, Cell biology, Image analysis, +5',
  },
  {
    frame: 'Settings',
    variant: 'agents',
    path: '/work/settings?tab=agents',
    ready: 'text=Token …41c0 · scopes contribute',
  },
];
