// Phase 7 screens (P7-05/06): F-10 Quality check card, F-06 Self-check, F-09 Quality column,
// F-14 Models and F-13 Background jobs. Escalation, Agent review, Evidence and the Reviewer agent
// panel are later phases, so scores are diagnostic only.
export default [
  {
    frame: 'Review',
    variant: 'escalated',
    path: '/work/proposals/fix-pinhole-units',
    ready: 'text=Line 14 · medium ·',
  },
  {
    frame: 'Editor',
    variant: 'write',
    path: '/wiki/confocal-microscopy.md/edit?section=principle',
    ready: 'text=Advice only. It doesn’t block submitting.',
  },
  {
    frame: 'Proposals',
    variant: 'open',
    path: '/work/proposals?tab=open',
    ready: 'td:has-text("Running")',
  },
  {
    frame: 'Settings',
    variant: 'models',
    path: '/work/settings?tab=models',
    ready: 'text=rules/quality.md',
  },
  {
    frame: 'Ops',
    variant: 'default',
    path: '/work/ops',
    ready: 'td:has-text("quality_check")',
  },
];
