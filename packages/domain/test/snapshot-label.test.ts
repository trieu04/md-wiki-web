import { expect, it } from 'vitest';
import { nextLabel } from '../src/snapshot-label.js';

it('increments the largest numeric suffix for the capture date', () => {
  const now = new Date('2026-11-23T23:59:59.999Z');
  expect(nextLabel([], now)).toBe('20261123-1');
  expect(nextLabel(['20261123-10', '20261123-2', '20261123-9'], now)).toBe('20261123-11');
});
it('starts over at UTC midnight, not local midnight', () => {
  const labels = ['20261123-10'];
  expect(nextLabel(labels, new Date('2026-11-23T18:59:59.999-05:00'))).toBe('20261123-11');
  expect(nextLabel(labels, new Date('2026-11-23T19:00:00-05:00'))).toBe('20261124-1');
});
