import { describe, expect, it } from 'vitest';
import { composeProposed, rebasePlan, regionOf, sectionChangedBetween } from '../src/draft.js';
import { renderStatusBlock } from '../src/status-block.js';

const status = renderStatusBlock({
  proposal: 'earlier',
  decision: '019ab789-97fd-72dc-b74c-2321af809fe6',
  reviewer: 'agent',
  decided_at: '2026-11-23T10:42:00Z',
});
const body = 'Intro.\n\n## Principle\n\nA laser.\n\n## Detectors\n\nPMT.\n';
const page = status + body;

describe('regionOf', () => {
  it('returns the section source and its line in the stored file', () => {
    expect(regionOf(page, 'principle')).toEqual({
      text: '## Principle\n\nA laser.\n\n',
      startLine: 10,
    });
    expect(regionOf(page, 'lead')).toEqual({ text: 'Intro.\n\n', startLine: 8 });
    expect(regionOf(page, null)).toEqual({ text: body, startLine: 8 });
    expect(regionOf(body, null)).toEqual({ text: body, startLine: 1 });
    expect(regionOf(page, 'missing')).toBeNull();
    expect(regionOf(null, null)).toEqual({ text: '', startLine: 1 });
    expect(regionOf(null, 'principle')).toBeNull();
  });

  it('handles CRLF, duplicate headings and a heading inside a code fence', () => {
    const crlf = '## A\r\n\r\nx\r\n## A\r\n\r\ny\r\n```\r\n## Not\r\n```\r\n';
    expect(regionOf(crlf, 'a-1')).toEqual({
      text: '## A\r\n\r\ny\r\n```\r\n## Not\r\n```\r\n',
      startLine: 4,
    });
  });
});

describe('composeProposed', () => {
  it('replaces only the scoped section, strips the status block, keeps other bytes', () => {
    const result = composeProposed(page, 'principle', '## Principle\n\nA scanned laser.\n\n');
    expect(result).toEqual({
      ok: true,
      value: 'Intro.\n\n## Principle\n\nA scanned laser.\n\n## Detectors\n\nPMT.\n',
    });
  });

  it('adds one LF before a following heading, but not for the last section', () => {
    expect(composeProposed(page, 'principle', '## Principle\n\nNo newline')).toEqual({
      ok: true,
      value: 'Intro.\n\n## Principle\n\nNo newline\n## Detectors\n\nPMT.\n',
    });
    expect(composeProposed(page, 'detectors', '## Detectors\n\nHyD')).toEqual({
      ok: true,
      value: 'Intro.\n\n## Principle\n\nA laser.\n\n## Detectors\n\nHyD',
    });
    expect(composeProposed(page, 'principle', '')).toEqual({
      ok: true,
      value: 'Intro.\n\n## Detectors\n\nPMT.\n',
    });
  });

  it('uses the content as the page for whole-page scope and creates', () => {
    expect(composeProposed(page, null, 'All new')).toEqual({ ok: true, value: 'All new' });
    expect(composeProposed(null, null, '# New\n')).toEqual({ ok: true, value: '# New\n' });
    expect(composeProposed(null, 'x', '# New\n')).toEqual({ ok: false, error: 'UNKNOWN_SECTION' });
    expect(composeProposed(page, 'missing', 'x')).toEqual({ ok: false, error: 'UNKNOWN_SECTION' });
  });

  it('preserves CRLF elsewhere in the file and a BOM in the lead', () => {
    const crlf = '﻿Lead\r\n\r\n## A\r\n\r\nx\r\n\r\n## B\r\n\r\ny\r\n';
    expect(composeProposed(crlf, 'a', '## A\r\n\r\nz\r\n\r\n')).toEqual({
      ok: true,
      value: '﻿Lead\r\n\r\n## A\r\n\r\nz\r\n\r\n## B\r\n\r\ny\r\n',
    });
  });
});

describe('rebasePlan (system-logic §7.2.3)', () => {
  const v1 = { markdown: page, sha256: 'a' };
  const otherChanged = { markdown: page.replace('PMT.', 'HyD.'), sha256: 'b' };
  const sectionChanged = { markdown: page.replace('A laser.', 'A beam.'), sha256: 'c' };
  const sectionGone = { markdown: status + 'Intro.\n\n## Detectors\n\nPMT.\n', sha256: 'd' };
  const edited = '## Principle\n\nMy edit.\n\n';
  const plan = (
    current: typeof v1 | null,
    mode: 'auto' | 'keep_mine',
    content = edited,
    section: string | null = 'principle',
    base: typeof v1 | null = v1,
  ) => rebasePlan({ section, content, base, current, mode });

  it('is a no-op when the target did not change', () => {
    expect(plan(v1, 'auto')).toEqual({ ok: true, value: { kind: 'noop' } });
    expect(plan(null, 'auto', '', null, null)).toEqual({ ok: true, value: { kind: 'noop' } });
  });

  it('re-pins and keeps edits when only other sections changed', () => {
    expect(plan(otherChanged, 'auto')).toEqual({
      ok: true,
      value: { kind: 'repin', content: edited },
    });
  });

  it('refuses to overwrite a changed section unless the author keeps theirs', () => {
    expect(plan(sectionChanged, 'auto')).toEqual({ ok: false, error: 'SECTION_CHANGED' });
    expect(plan(sectionChanged, 'keep_mine')).toEqual({
      ok: true,
      value: { kind: 'repin', content: edited },
    });
    expect(plan(sectionGone, 'auto')).toEqual({ ok: false, error: 'SECTION_CHANGED' });
    expect(plan(sectionGone, 'keep_mine')).toEqual({ ok: false, error: 'SECTION_CHANGED' });
  });

  it('takes the new text when the draft was not edited', () => {
    const unedited = regionOf(page, 'principle')?.text ?? '';
    expect(plan(sectionChanged, 'auto', unedited)).toEqual({
      ok: true,
      value: { kind: 'repin', content: '## Principle\n\nA beam.\n\n' },
    });
    expect(plan(otherChanged, 'auto', body, null)).toEqual({
      ok: true,
      value: { kind: 'repin', content: otherChanged.markdown.slice(status.length) },
    });
  });

  it('treats any edited whole-page change as stale unless kept', () => {
    expect(plan(otherChanged, 'auto', 'mine', null)).toEqual({ ok: false, error: 'STALE_BASE' });
    expect(plan(otherChanged, 'keep_mine', 'mine', null)).toEqual({
      ok: true,
      value: { kind: 'repin', content: 'mine' },
    });
  });

  it('is stale when the target was removed or created meanwhile', () => {
    expect(plan(null, 'keep_mine')).toEqual({ ok: false, error: 'STALE_BASE' });
    expect(plan(v1, 'keep_mine', 'new', null, null)).toEqual({ ok: false, error: 'STALE_BASE' });
  });
});

it('sectionChangedBetween compares section hashes', () => {
  expect(sectionChangedBetween(page, page.replace('PMT.', 'HyD.'), 'principle')).toBe(false);
  expect(sectionChangedBetween(page, page.replace('A laser.', 'A laser.  '), 'principle')).toBe(
    false,
  );
  expect(sectionChangedBetween(page, page.replace('A laser.', 'Beam'), 'principle')).toBe(true);
  expect(sectionChangedBetween(page, null, 'principle')).toBe(true);
  expect(sectionChangedBetween(page, page + 'x', null)).toBe(true);
});
