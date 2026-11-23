import { expect, it } from 'vitest';
import { formatRelative, formatDate } from '../src/time.js';

const minute = 60_000,
  hour = minute * 60,
  day = hour * 24;
const now = new Date('2026-11-29T00:00:00Z');
it.each<[number, string]>([
  [0, 'just now'],
  [minute - 1, 'just now'],
  [minute, '1 min ago'],
  [hour - 1, '59 min ago'],
  [hour, '1 h ago'],
  [day - 1, '23 h ago'],
  [day, '1 d ago'],
  [7 * day - 1, '6 d ago'],
  [7 * day, '22 Nov'],
  [372 * day, '22 Nov 2025'],
])('formats a %i ms difference as %s', (ms, result) => {
  expect(formatRelative(new Date(now.getTime() - ms), now)).toBe(result);
});
it('formats day and short month in UTC without year or leading zero', () => {
  expect(formatDate(new Date('2026-11-04T23:50:00-02:00'))).toBe('5 Nov');
});
