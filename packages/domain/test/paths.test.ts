import { posix } from 'node:path';
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { validateWikiPath, type PathError } from '../src/paths.js';

it.each<[string, PathError]>([
  ['/page.md', 'ABSOLUTE'],
  ['../page.md', 'TRAVERSAL'],
  ['a/../b.md', 'TRAVERSAL'],
  ['./page.md', 'TRAVERSAL'],
  ['', 'EMPTY_SEGMENT'],
  ['a//b.md', 'EMPTY_SEGMENT'],
  ['dir/', 'EMPTY_SEGMENT'],
  ['.wiki-system/receipts/file.md', 'RESERVED_PATH'],
  ['a/.hidden/b.md', 'RESERVED_PATH'],
  ['.file.md', 'RESERVED_PATH'],
  ['wiki\\page.md', 'NOT_PORTABLE'],
  ['x\0.md', 'NOT_PORTABLE'],
  ['café.md', 'NOT_PORTABLE'],
  ['Page.md', 'NOT_PORTABLE'],
  ['two words.md', 'NOT_PORTABLE'],
  ['dir!/x.md', 'NOT_PORTABLE'],
  ['-file.md', 'NOT_PORTABLE'],
  ['_dir/page.md', 'NOT_PORTABLE'],
  ['two.dots.md', 'NOT_PORTABLE'],
  ['a.txt', 'NOT_MARKDOWN'],
  ['file', 'NOT_MARKDOWN'],
  ['file.MD', 'NOT_MARKDOWN'],
  ['a'.repeat(198) + '.md', 'TOO_LONG'],
  ['é'.repeat(99) + '.md', 'TOO_LONG'],
  ['a/'.repeat(8) + 'a.md', 'TOO_DEEP'],
])('rejects %j with %s', (path, error) => {
  expect(validateWikiPath(path)).toEqual({ ok: false, error });
});

it.each<[string, boolean]>([
  ['0.md', false],
  ['0_2/a-1_b.md', false],
  ['wiki-meta/topics.md', true],
  ['a/wiki-meta/topics.md', false],
  ['wiki-meta.md', false],
  ['a/'.repeat(7) + 'x.md', false],
  ['a'.repeat(197) + '.md', false],
])('accepts %s without rewriting', (path, isMeta) => {
  expect(validateWikiPath(path)).toEqual({ ok: true, value: { path, isMeta } });
});

it('only accepts paths already in normal form and free of double dots', () => {
  const segment = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,20}$/);
  const portable = fc
    .array(segment, { minLength: 1, maxLength: 8 })
    .map((s) => s.join('/') + '.md');
  fc.assert(
    fc.property(fc.oneof(fc.string(), portable), (path) => {
      const result = validateWikiPath(path);
      if (result.ok) {
        expect(result.value.path).toBe(path);
        expect(posix.normalize(path)).toBe(path);
        expect(path).not.toContain('..');
      }
    }),
  );
});
