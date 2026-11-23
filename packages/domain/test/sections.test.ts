import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { pageTitle, sectionHash, splitSections } from '../src/sections.js';
import { renderStatusBlock } from '../src/status-block.js';

it('partitions source text on root headings only, retaining original inclusive line numbers', () => {
  const prefix = renderStatusBlock({
    proposal: 'update',
    decision: '019ab789-97fd-72dc-b74c-2321af809fe6',
    reviewer: 'person',
    decided_at: '2026-11-23T10:42:00Z',
    lineEnding: '\r\n',
  });
  const sources = [
    'Intro\r\n\r\n',
    '## Early\r\n> # Quote\r\n\r\n- # List\r\n\r\n```md\r\n# Code\r\n```\r\n',
    'My *wiki* [page](docs)\r\n=====================\r\n',
    '### Details\r\n',
  ];
  const sections = splitSections(prefix + sources.join(''));
  expect(
    sections.map(({ anchor, level, startLine, endLine }) => [anchor, level, startLine, endLine]),
  ).toEqual([
    ['lead', 0, 8, 9],
    ['early', 2, 10, 17],
    ['my-wiki-page', 1, 18, 19],
    ['details', 3, 20, 20],
  ]);
  expect(sections.map((s) => s.text)).toEqual(sources);
  expect(sections.map((s) => s.hash)).toEqual(sources.map(sectionHash));
  expect(pageTitle('docs/fallback.md', sections)).toBe('My wiki page');
});

it('reserves lead even in the absence of a preamble, and scopes duplicate numbering to a page', () => {
  const source = '\n# Lead\n## Lead\n### ~~Foo~~!\n# Foo!\n# Foo!';
  for (let i = 0; i < 2; i++) {
    expect(splitSections(source).map((s) => s.anchor)).toEqual([
      'lead-1',
      'lead-2',
      'foo',
      'foo-1',
      'foo-2',
    ]);
  }
});

it.each(['', ' \n\t\r\n'])('returns no sections for blank input %j', (md) => {
  expect(splitSections(md)).toEqual([]);
});

it('keeps headingless content, including decoded replacement characters, as one lead section', () => {
  // Invalid UTF-8 bytes themselves are rejected by storage (P1-C).
  const text = 'First paragraph.\n\nSecond \uFFFD paragraph.';
  expect(splitSections(text)).toEqual([
    {
      anchor: 'lead',
      title: 'Lead',
      level: 0,
      startLine: 1,
      endLine: 3,
      text,
      hash: sectionHash(text),
    },
  ]);
});

it('recognises a heading after BOM and preserves the original source', () => {
  const text = '\uFEFF# One\rdata\r';
  expect(splitSections(text)).toEqual([
    {
      anchor: 'one',
      title: 'One',
      level: 1,
      startLine: 1,
      endLine: 2,
      text,
      hash: sectionHash(text),
    },
  ]);
});

it('does not truncate decoded Markdown of 1 MiB + 1 byte', () => {
  const text = 'a'.repeat(1024 * 1024 + 1);
  const sections = splitSections(text);
  expect(sections).toHaveLength(1);
  expect(sections[0]?.text).toBe(text);
});

it('normalises line endings, trailing whitespace and final blank lines only for hashing', () => {
  const hash = sectionHash('# Title\nA word\n');
  expect(sectionHash('# Title  \r\nA word\t\r\n   \r\n')).toBe(hash);
  expect(sectionHash('# Title\rA word')).toBe(hash);
  for (const changed of [
    '# Title\nA change',
    '# Rename\nA word',
    '# Title\n A word',
    '# Title\n\nA word',
  ]) {
    expect(sectionHash(changed)).not.toBe(hash);
  }
});

it('chooses the first H1 or derives a title from just the basename', () => {
  expect(pageTitle('my-topic/a_b-page.md', splitSections('## First\n# `Main`\n# Last'))).toBe(
    'Main',
  );
  expect(pageTitle('my-topic/a_b-page.md', splitSections('## Subtitle'))).toBe('A b page');
});

it.each([
  [
    'lab-notes/image-observations.md',
    'Recording Image Observations',
    'recording-image-observations',
    '02da8faa9df39dd31aef5a5dffa5e4c908d5c98c87862a95104d7b7427bb42e2',
  ],
  [
    'microscopy/basics.md',
    'Microscopy Basics',
    'microscopy-basics',
    '7dfe2820769da999e9248da989f4b0a857eb40b3115f66c82f8ee62d6d96f6c1',
  ],
  [
    'microscopy/sample-preparation.md',
    'Sample Preparation',
    'sample-preparation',
    '1687c9c6b0a14b9c7e504025a603dad086a99c805989e1124819c2ec203ec864',
  ],
])('matches wiki-sample/%s golden partition', (path, title, anchor, hash) => {
  const text = readFileSync(new URL(`../../../wiki-sample/${path}`, import.meta.url), 'utf8');
  expect(splitSections(text)).toEqual([
    { title, anchor, hash, text, level: 1, startLine: 1, endLine: 5 },
  ]);
});
