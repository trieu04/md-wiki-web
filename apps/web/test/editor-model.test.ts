import { describe, expect, it } from 'vitest';
import { visualDraft } from '../src/dev/fixtures/contribute';
import { ApiError } from '../src/lib/api';
import {
  addAppliesTo,
  afterSubmitModel,
  applyFormat,
  baseChangedModel,
  changesModel,
  editorHeaderModel,
  editorHref,
  gutterModel,
  isEmptyPatch,
  settlePatch,
  sourcesModel,
  submitErrorModel,
  submitModel,
} from '../src/features/editor/model';
import { canSuggest } from '../src/features/page/model';

const draft = visualDraft(false);
const changed = visualDraft(true);

describe('F-06 editor model', () => {
  it('builds the route with an optional section', () => {
    expect(editorHref('confocal-microscopy.md', 'principle')).toBe(
      '/wiki/confocal-microscopy.md/edit?section=principle',
    );
    expect(editorHref('a b/c.md', null)).toBe('/wiki/a%20b/c.md/edit');
    expect(editorHref('x.md', '')).toBe('/wiki/x.md/edit');
  });

  it('renders the frame header line and hides Whole page when already whole page', () => {
    expect(editorHeaderModel(draft, { saving: false })).toEqual({
      path: 'confocal-microscopy.md',
      pageHref: '/wiki/confocal-microscopy.md',
      title: 'Suggest an edit · Principle',
      subtitle: 'Draft saved 10:42 · editing from version 20261120-1 · section #principle',
      wholePageAction: true,
      canExport: true,
    });
    expect(editorHeaderModel(draft, { saving: true }).subtitle).toMatch(/^Saving… · /);
    const whole = { ...draft, section: null, sectionTitle: null };
    expect(editorHeaderModel(whole, { saving: false })).toMatchObject({
      title: 'Suggest an edit',
      wholePageAction: false,
    });
    const created = { ...whole, base: null };
    expect(editorHeaderModel(created, { saving: false })).toMatchObject({
      subtitle: 'Draft saved 10:42 · new page · whole page',
      canExport: false,
    });
  });

  it('words the baseChanged banner by whether the edited section moved', () => {
    expect(baseChangedModel(draft)).toBeNull();
    expect(baseChangedModel(changed)).toEqual({
      title: 'The page changed since you started.',
      text: 'Version 20261123-2 touched #principle. Rebase before submitting; your text is kept.',
    });
    expect(baseChangedModel({ ...changed, sectionChanged: false })?.text).toBe(
      'Version 20261123-2 changed other parts of the page. Rebase before submitting; your text is kept.',
    );
    expect(baseChangedModel({ ...changed, current: null })?.title).toBe('The page is gone.');
  });

  it('shows only changed lines, numbered from the region start, with the frame summary', () => {
    const changes = changesModel(draft, draft.content);
    expect(changes.rows).toEqual([
      {
        kind: 'del',
        number: 14,
        text: 'Closing the pinhole improves sectioning and reduces the detected signal.',
      },
      {
        kind: 'add',
        number: 14,
        text: 'Closing the pinhole below about 1 Airy unit (AU) gives little extra sectioning and reduces the detected signal.[^4]',
      },
      { kind: 'add', number: 16, text: '[^4]: sources/pawley-handbook.md, §2.4' },
    ]);
    expect(changes.summary).toBe('1 line changed · 1 footnote added');
    expect(changes.scope).toBe('Only #principle is in scope');
    expect(changesModel(draft, draft.baseText)).toMatchObject({ rows: [], summary: 'No changes' });
    expect(changesModel({ ...draft, section: null }, draft.content).scope).toBe(
      'The whole page is in scope',
    );
  });

  it('compares against the current text after SECTION_CHANGED, and falls back without it', () => {
    const rows = changesModel(changed, changed.content, true).rows;
    expect(rows[0]?.kind).toBe('del');
    expect(rows[0]?.text).toContain('sharpens');
    expect(changesModel(draft, draft.content, true).rows[0]?.text).toContain('improves');
  });

  it('numbers the gutter from the region start, one row per line incl. a trailing empty line', () => {
    expect(gutterModel(10, '## Principle\n\nText\n')).toEqual([10, 11, 12, 13]);
    expect(gutterModel(1, '')).toEqual([1]);
    expect(gutterModel(5, 'one')).toEqual([5]);
  });

  it('lists pinned sources then the target, without tier meta (D-67)', () => {
    expect(sourcesModel(draft)).toEqual([
      {
        path: 'sources/pawley-handbook.md',
        meta: 'Version 20261118-1 · pinned when you added it',
        changed: false,
        removable: true,
      },
      {
        path: 'confocal-microscopy.md (target)',
        meta: 'Version 20261120-1 · read when you opened the editor',
        changed: false,
        removable: false,
      },
    ]);
    const stale = {
      ...draft,
      base: null,
      sources: draft.sources.map((s) => ({ ...s, changed: true })),
    };
    expect(sourcesModel(stale)).toEqual([
      expect.objectContaining({
        changed: true,
        meta: 'Version 20261118-1 · changed since you pinned it',
      }),
    ]);
  });

  it("names the maintainers after submit, else the page's authors", () => {
    expect(afterSubmitModel(['m.nguyen', 'h.pham'])).toEqual([
      'Quality check (about 2 min)',
      'A reviewer decides, or escalates to m.nguyen and h.pham',
      'If approved: published automatically',
    ]);
    expect(afterSubmitModel([])[1]).toBe("A reviewer decides, or escalates to the page's authors");
    expect(afterSubmitModel(undefined)[1]).toContain("the page's authors");
  });

  it('disables submit while the base changed', () => {
    expect(submitModel(draft)).toEqual({ label: 'Submit proposal', disabled: false });
    expect(submitModel(changed)).toEqual({ label: 'Rebase before submitting', disabled: true });
  });

  it('settles only the fields the server stored, keeping later typing', () => {
    const sent = { content: 'a', reason: 'r' };
    expect(settlePatch(sent, sent)).toEqual({});
    expect(settlePatch({ content: 'ab', reason: 'r' }, sent)).toEqual({ content: 'ab' });
    const rows = [{ name: 'LAS X', version: '4.1' }];
    expect(settlePatch({ appliesTo: rows }, { appliesTo: rows })).toEqual({});
    expect(settlePatch({ appliesTo: [...rows] }, { appliesTo: rows })).toEqual({ appliesTo: rows });
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ reason: '' })).toBe(false);
  });

  it('maps submit errors to the reason field or the aside', () => {
    expect(
      submitErrorModel(new ApiError('VALIDATION_FAILED', 400, null, null, ['reason'])),
    ).toEqual({
      field: 'reason',
      code: 'VALIDATION_FAILED',
    });
    expect(submitErrorModel(new ApiError('STALE_BASE', 409))).toEqual({
      field: null,
      code: 'STALE_BASE',
    });
    expect(submitErrorModel(new Error('x'))).toEqual({ field: null, code: 'INTERNAL' });
  });

  it('validates applies-to rows: both fields, unique names ignoring case', () => {
    expect(addAppliesTo([], ' LAS X ', ' 4.1 ')).toEqual({
      ok: true,
      rows: [{ name: 'LAS X', version: '4.1' }],
    });
    expect(addAppliesTo([], 'LAS X', ' ')).toEqual({
      ok: false,
      error: 'Enter a name and a version.',
    });
    expect(addAppliesTo([{ name: 'LAS X', version: '4' }], 'las x', '5')).toEqual({
      ok: false,
      error: 'las x is already listed.',
    });
  });

  it('applies toolbar formats around the selection', () => {
    expect(applyFormat('a word b', 2, 6, 'bold')).toEqual({
      text: 'a **word** b',
      start: 4,
      end: 8,
    });
    expect(applyFormat('ab', 1, 1, 'italic')).toEqual({ text: 'a_text_b', start: 2, end: 6 });
    expect(applyFormat('see this', 4, 8, 'link').text).toBe('see [this](page.md)');
    expect(applyFormat('one\ntwo', 5, 5, 'heading')).toEqual({
      text: 'one\n## two',
      start: 8,
      end: 8,
    });
    expect(applyFormat('## two', 3, 3, 'heading').text).toBe('### two');
    const footnote = applyFormat('Claim.[^1]\n\n[^1]: a\n', 6, 6, 'footnote');
    expect(footnote.text).toBe('Claim.[^2][^1]\n\n[^1]: a\n\n[^2]: ');
    expect(footnote.start).toBe(footnote.text.length);
    expect(applyFormat('x', 1, 1, 'table').text).toBe(
      'x\n| Column | Column |\n| --- | --- |\n| Value | Value |\n',
    );
    expect(applyFormat('', 0, 0, 'table').start).toBe(0);
  });
});

describe('F-03 Suggest an edit', () => {
  it('is shown to roles at or above contributor', () => {
    expect(canSuggest(['contributor'])).toBe(true);
    expect(canSuggest(['reader', 'owner'])).toBe(true);
    expect(canSuggest(['reader'])).toBe(false);
    expect(canSuggest([])).toBe(false);
    expect(canSuggest(undefined)).toBe(false);
  });
});
