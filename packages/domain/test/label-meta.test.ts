import { expect, it } from 'vitest';
import { labelMeta } from '../src/index.js';

it('maps every section label to the exact reader-facing words', () => {
  expect(labelMeta).toEqual({
    checked: 'Checked against source',
    reviewed: 'Reviewed',
    not_reviewed: 'Not reviewed',
    recheck: 'Under re-check',
    error: 'Confirmed error',
  });
});
