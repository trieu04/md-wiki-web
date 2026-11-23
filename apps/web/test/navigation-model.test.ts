import { expect, it } from 'vitest';
import { userInitials, wikiPageHref } from '../src/features/navigation/model';

it.each([
  ['Mai Nguyen', 'MN'],
  ['m.nguyen', 'MN'],
  ['  Le Thu  ', 'LT'],
  [' Ada ', 'A'],
  ['Élodie 王', 'É王'],
  ['...', ''],
  [undefined, ''],
])('derives initials from %s', (name, expected) => {
  expect(userInitials(name)).toBe(expected);
});

it('keeps nested wiki paths and encodes path segments and section fragments', () => {
  expect(wikiPageHref('methods/Objective & lens.md', 'size #1')).toBe(
    '/wiki/methods/Objective%20%26%20lens.md#size%20%231',
  );
});
