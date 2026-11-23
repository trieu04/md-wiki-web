import { describe, expect, it } from 'vitest';
import { diffStats, lineDiff, splitLines } from '../src/line-diff.js';
import { deriveTitle, isSlug, proposalTitle, slugCandidate, slugify } from '../src/slug.js';
import { formatTime } from '../src/time.js';

describe('slugs (D-6, D-61)', () => {
  it('kebab-cases titles, strips diacritics and punctuation', () => {
    expect(slugify('Fix pinhole units')).toBe('fix-pinhole-units');
    expect(slugify('  Tiếng Việt: độ phân giải!! ')).toBe('tieng-viet-o-phan-giai');
    expect(slugify('Ångström & µm')).toBe('angstrom-m');
    expect(slugify('???')).toBe('suggestion');
    expect(slugify('')).toBe('suggestion');
  });

  it('cuts long titles at a hyphen within 60 chars', () => {
    const slug = slugify(
      'state the pinhole size in airy units as the handbook does for every objective',
    );
    expect(slug).toBe('state-the-pinhole-size-in-airy-units-as-the-handbook-does');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slugify('x'.repeat(70))).toBe('x'.repeat(60));
    expect(isSlug(slug)).toBe(true);
  });

  it('numbers collisions from -2 and validates the grammar', () => {
    expect([1, 2, 3].map((n) => slugCandidate('fix', n))).toEqual(['fix', 'fix-2', 'fix-3']);
    expect(isSlug('fix-2')).toBe(true);
    expect(isSlug('Fix')).toBe(false);
    expect(isSlug('a'.repeat(81))).toBe(false);
  });

  it('derives a title from the first non-blank reason line', () => {
    expect(deriveTitle('\n  State the pinhole size.  \nMore detail')).toBe(
      'State the pinhole size.',
    );
    const long = 'word '.repeat(30).trim();
    const title = deriveTitle(long);
    expect(title.endsWith('…')).toBe(true);
    expect(Array.from(title).length).toBeLessThanOrEqual(80);
    expect(deriveTitle('')).toBe('');
    expect(proposalTitle('  Given  ', 'reason')).toBe('Given');
    expect(proposalTitle(' ', 'From reason')).toBe('From reason');
    expect(proposalTitle(null, 'From reason')).toBe('From reason');
  });
});

describe('lineDiff', () => {
  it('reproduces the F-06 Changes sample: one changed line, one footnote added', () => {
    const before = [
      '## Principle',
      '',
      'A laser is scanned across the sample.',
      'Closing the pinhole improves sectioning and reduces the detected signal.',
      '',
      '',
    ].join('\n');
    const after = [
      '## Principle',
      '',
      'A laser is scanned across the sample.',
      'Closing the pinhole below about 1 Airy unit (AU) gives little extra sectioning and reduces the detected signal.[^4]',
      '',
      '[^4]: sources/pawley-handbook.md, §2.4',
    ].join('\n');
    const diff = lineDiff(before, after, 11);
    expect(
      diff.filter((l) => l.kind !== 'same').map((l) => [l.kind, l.oldLine, l.newLine]),
    ).toEqual([
      ['del', 14, null],
      ['add', null, 14],
      ['add', null, 16],
    ]);
    expect(diffStats(diff)).toEqual({ changed: 1, added: 0, removed: 0, footnotesAdded: 1 });
  });

  it('handles empty sides, CRLF and missing final newline', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(lineDiff('', 'a\nb').map((l) => l.kind)).toEqual(['add', 'add']);
    expect(lineDiff('a\r\nb\r\n', 'a\nb').map((l) => l.kind)).toEqual(['same', 'same']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(diffStats(lineDiff('a\nb\nc', 'a\nc'))).toEqual({
      changed: 0,
      added: 0,
      removed: 1,
      footnotesAdded: 0,
    });
  });

  it('accounts for every line of both sides on random inputs', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 4;
    for (let round = 0; round < 50; round++) {
      const a = Array.from({ length: 12 }, () => String(rand())).join('\n');
      const b = Array.from({ length: 9 }, () => String(rand())).join('\n');
      const diff = lineDiff(a, b);
      expect(diff.filter((l) => l.kind !== 'add').map((l) => l.text)).toEqual(splitLines(a));
      expect(diff.filter((l) => l.kind !== 'del').map((l) => l.text)).toEqual(splitLines(b));
    }
  });
});

it('formatTime renders UTC clock time', () => {
  expect(formatTime(new Date('2026-11-23T10:42:59Z'))).toBe('10:42');
  expect(formatTime(new Date('2026-11-23T03:05:00Z'))).toBe('03:05');
});
