import type { Label } from './labels.js';

// Reader-facing words for the system-logic §6 labels (design-system §3).
export const labelMeta = {
  checked: 'Checked against source',
  reviewed: 'Reviewed',
  not_reviewed: 'Not reviewed',
  recheck: 'Under re-check',
  error: 'Confirmed error',
} as const satisfies Record<Label, string>;
