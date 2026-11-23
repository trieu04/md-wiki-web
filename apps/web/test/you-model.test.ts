import { describe, expect, it } from 'vitest';
import { visualSuggestions } from '../src/dev/fixtures/contribute';
import {
  suggestionRow,
  suggestionsModel,
  youSubtitle,
  type SuggestionDto,
} from '../src/features/you/model';

const now = new Date('2026-11-23T12:00:00Z');
const [stale, published, draft] = visualSuggestions.items as [
  SuggestionDto,
  SuggestionDto,
  SuggestionDto,
];

describe('F-05 Your suggestions (D-69)', () => {
  it('maps the frame rows', () => {
    const model = suggestionsModel([visualSuggestions], now);
    expect(model.total).toBe(3);
    expect(
      model.rows.map(({ page, section, what, label, status, detail, action }) => ({
        page,
        section,
        what,
        label,
        status,
        detail,
        action,
      })),
    ).toEqual([
      {
        page: 'Confocal microscopy',
        section: 'Detectors',
        what: 'Detector comparison table',
        label: 'recheck',
        status: 'Needs your attention',
        detail: 'The page changed under it',
        action: 'Resolve',
      },
      {
        page: 'STED microscopy',
        section: 'Principle',
        what: 'Depletion wavelength',
        label: 'reviewed',
        status: 'Published',
        detail: '',
        action: 'View',
      },
      {
        page: 'Confocal microscopy',
        section: 'Principle',
        what: 'Draft: pinhole units',
        label: 'not_reviewed',
        status: 'Draft',
        detail: 'Saved 10:42',
        action: 'Continue',
      },
    ]);
  });

  it('links drafts to the editor, stale proposals to resolve, others to the page', () => {
    expect(suggestionRow(draft, now).href).toBe(
      '/wiki/confocal-microscopy.md/edit?section=principle',
    );
    expect(suggestionRow(stale, now).href).toBe(`/me/suggestions/${stale.id}/resolve`);
    expect(suggestionRow({ ...draft, needsAttention: true }, now)).toMatchObject({
      action: 'Resolve',
      what: 'Draft: pinhole units',
      href: '/wiki/confocal-microscopy.md/edit?section=principle',
    });
    expect(suggestionRow({ ...draft, section: null, sectionTitle: null }, now)).toMatchObject({
      section: 'Whole page',
      href: '/wiki/confocal-microscopy.md/edit',
    });
    expect(suggestionRow(published, now).href).toBe('/wiki/sted-microscopy.md');
  });

  it('words pending, approved and rejected proposals', () => {
    const pending = { ...published, state: 'pending' as const, at: '2026-11-23T09:00:00Z' };
    expect(suggestionRow(pending, now)).toMatchObject({
      status: 'Waiting for review',
      detail: 'Submitted 3 h ago',
      action: 'View',
    });
    expect(suggestionRow({ ...published, state: 'approved' }, now).status).toBe('Approved');
    expect(suggestionRow({ ...published, state: 'rejected' }, now)).toMatchObject({
      status: 'Not accepted',
      label: 'not_reviewed',
    });
  });

  it('concatenates pages and keeps the first page total; empty when nothing loaded', () => {
    const second = { ...visualSuggestions, total: 99, items: [draft] };
    const model = suggestionsModel([visualSuggestions, second], now);
    expect(model.total).toBe(3);
    expect(model.rows).toHaveLength(4);
    expect(suggestionsModel([], now)).toEqual({ total: 0, rows: [] });
  });

  it('shows the user name in the subtitle', () => {
    expect(youSubtitle('m.nguyen')).toBe(
      'm.nguyen · Your drafts and suggestions, and what happened to them.',
    );
    expect(youSubtitle(null)).toMatch(/^You · /);
  });
});
