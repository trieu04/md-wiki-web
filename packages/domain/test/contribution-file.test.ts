import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/bundle.js';
import {
  CONTRIBUTION_FILE_LIMIT,
  parseContribution,
  renderContribution,
  type RenderContributionInput,
} from '../src/contribution-file.js';

const enc = new TextEncoder();
const hash = (text: string) => sha256Hex(enc.encode(text));

// The md-wiki test_web fixture, verbatim apart from the hashes.
function mdWikiFile(
  proposed = '# Updated\n',
  base = '# Wiki\n',
  sources = '| source.md | 20260101-1 |',
) {
  return `# Wiki contribution

| Field | Value |
| --- | --- |
| Format | wiki-contribution-v3 |
| Boundary | wc-test |
| ID | contribution-1 |
| Base SHA-256 | ${hash(base)} |
| Proposed SHA-256 | ${hash(proposed)} |
| Author | informational-author |
| Reason | Source checked |

## Scope and impact files

| File | Version | Impact |
| --- | --- | --- |
| index.md | 20260101-1 | Update heading |

## Sources

| File | Version |
| --- | --- |
${sources}

## Proposed content

--- wc-test:proposed ---

${proposed}

--- wc-test:base ---

## Base content

${base}

--- wc-test:end ---
`;
}
const parse = (text: string) => parseContribution(enc.encode(text));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('parseContribution (md-wiki contribution_file)', () => {
  it('reads the md-wiki fixture', () => {
    const result = parse(mdWikiFile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      id: 'contribution-1',
      author: 'informational-author',
      reason: 'Source checked',
      title: null,
      section: null,
      appliesTo: [],
      authorMetadata: null,
      scope: [{ path: 'index.md', version: '20260101-1', impact: 'Update heading' }],
      sources: [{ path: 'source.md', version: '20260101-1' }],
    });
    expect(decode(result.value.proposed)).toBe('# Updated\n');
    expect(decode(result.value.base)).toBe('# Wiki\n');
  });

  it('preserves payload bytes exactly (test_plain_contribution_preserves_bytes)', () => {
    for (const proposed of [
      'Tiếng Việt\n\n---\n## Base content\n<!-- contribution:base:end -->',
      'CRLF\r\nline\r\n',
      'Trailing\n\n',
      '',
    ]) {
      const result = parse(mdWikiFile(proposed, '# Wiki\n', '\n'));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(decode(result.value.proposed)).toBe(proposed);
        expect(result.value.sources).toEqual([]);
      }
    }
  });

  it('rejects bad breaks, trailing data and boundaries inside content', () => {
    const text = mdWikiFile();
    for (const bad of [
      text.replace('--- wc-test:base ---', '---'),
      text + 'extra',
      text.replace('--- wc-test:end ---', '--- wc-test:base ---'),
      text.replace('# Updated\n', 'wc-test\n'),
      text.replace('## Proposed content\n', '## Proposed content\nwc-test\n'),
    ])
      expect(parse(bad)).toMatchObject({ ok: false, error: { code: 'CONTRIBUTION_FORMAT' } });
  });

  it('rejects other formats, headers, duplicate and missing fields', () => {
    const text = mdWikiFile();
    for (const version of ['wiki-contribution-v1', 'wiki-contribution-v2', 'bad-format'])
      expect(parse(text.replace('wiki-contribution-v3', version)).ok).toBe(false);
    expect(parse('# not a contribution\n').ok).toBe(false);
    expect(parse(text.replace('| Author | informational-author |\n', '')).ok).toBe(false);
    expect(parse(text.replace('| Author |', '| Reason | twice |\n| Author |')).ok).toBe(false);
    expect(parse(text.replace('| Boundary | wc-test |', '| Boundary | WC-TEST |')).ok).toBe(false);
    expect(parseContribution(new Uint8Array([0xff])).ok).toBe(false);
  });

  it('rejects malformed, duplicate and conflicting reference rows', () => {
    const text = mdWikiFile();
    expect(
      parse(
        text.replace('| index.md | 20260101-1 | Update heading |', '| index.md | v1 | Update |'),
      ).ok,
    ).toBe(false);
    expect(
      parse(
        text.replace('| index.md | 20260101-1 | Update heading |', '| index.md | 20260101-1 |  |'),
      ).ok,
    ).toBe(false);
    expect(
      parse(
        text.replace(
          '| source.md | 20260101-1 |',
          '| source.md | 20260101-1 |\n| source.md | 20260101-1 |',
        ),
      ).ok,
    ).toBe(false);
    expect(parse(text.replace('| source.md | 20260101-1 |', '| index.md | 20260101-2 |')).ok).toBe(
      false,
    );
    const sameTarget = parse(
      text.replace('| source.md | 20260101-1 |', '| index.md | 20260101-1 |'),
    );
    expect(sameTarget.ok && sameTarget.value.sources).toEqual([]);
    const related = text.replace(
      '| index.md | 20260101-1 | Update heading |',
      '| index.md | 20260101-1 | Update heading |\n| source.md | 20260102-1 | Cites it |',
    );
    expect(parse(related).ok).toBe(false);
    expect(parse(text.replace('\n## Sources\n', '\n## Elsewhere\n')).ok).toBe(false);
  });

  it('unescapes table cells and reads optional rows', () => {
    const text = mdWikiFile().replace(
      '| Reason | Source checked |',
      '| Reason | a \\| b<br>c \\\\ d |\n| Title | Fix units |\n| Section | principle |\n| Applies to | Leica SP8 = 3.5<br>LAS X = 4.1 |\n| Author role | PhD student |',
    );
    const result = parse(text);
    expect(result.ok && result.value).toMatchObject({
      reason: 'a | b\nc \\ d',
      title: 'Fix units',
      section: 'principle',
      appliesTo: [
        { name: 'Leica SP8', version: '3.5' },
        { name: 'LAS X', version: '4.1' },
      ],
      authorMetadata: { role: 'PhD student' },
    });
    expect(parse(text.replace('Leica SP8 = 3.5', 'Leica SP8')).ok).toBe(false);
  });

  it('enforces the 4 MiB + 64 KiB file limit', () => {
    expect(parseContribution(new Uint8Array(CONTRIBUTION_FILE_LIMIT + 1))).toMatchObject({
      ok: false,
      error: { code: 'TOO_LARGE' },
    });
  });
});

describe('renderContribution', () => {
  const input: RenderContributionInput = {
    id: 'fix-pinhole-units',
    baseHash: hash('# Base\r\n'),
    proposedHash: hash('# Proposed\n\nwc-fixed\n'),
    author: 'm.nguyen',
    reason: 'Line one | pipe\nLine two \\ slash',
    title: 'Fix pinhole units',
    section: 'principle',
    appliesTo: [{ name: 'LAS X', version: '4.1' }],
    scope: [{ path: 'page.md', version: '20261120-1', impact: 'Edits section #principle' }],
    sources: [{ path: 'source.md', version: '20261118-1' }],
    base: '# Base\r\n',
    proposed: '# Proposed\n\nwc-fixed\n',
  };

  it('round-trips through parseContribution', () => {
    const tokens = ['wc-fixed', 'wc-other'];
    const text = renderContribution({ ...input, boundary: () => tokens.shift() ?? 'wc-z' });
    expect(text).toContain('--- wc-other:proposed ---');
    const result = parse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      id: input.id,
      baseHash: input.baseHash,
      proposedHash: input.proposedHash,
      reason: input.reason,
      title: input.title,
      section: input.section,
      appliesTo: input.appliesTo,
      scope: input.scope,
      sources: input.sources,
    });
    expect(decode(result.value.base)).toBe(input.base);
    expect(decode(result.value.proposed)).toBe(input.proposed);
  });

  it('renders an md-wiki compatible empty Sources table and random boundaries', () => {
    const text = renderContribution({
      ...input,
      sources: [],
      title: null,
      section: null,
      appliesTo: [],
    });
    expect(text).toMatch(
      /\| --- \| --- \|\n\n\n## Proposed content\n\n--- wc-[0-9a-f]{16}:proposed ---/,
    );
    expect(text).not.toContain('| Title |');
    const result = parse(text);
    expect(result.ok && result.value.sources).toEqual([]);
  });
});
