import '@testing-library/jest-dom/vitest';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { visualDraft, visualSuggestions } from '../src/dev/fixtures/contribute';
import { emptySummary, visualSelfCheck } from '../src/dev/fixtures/quality';
import type { QualityReportDto } from '../src/features/quality/model';
import { visualPage, visualSession } from '../src/dev/fixtures/reading';
import type { DraftDto } from '../src/features/editor/model';
import { credibilityHandlers } from '../src/dev/fixtures/credibility-handlers';
import { createAppRouter } from '../src/router';
import { DiffView } from '../src/ui/DiffView';
import { MarkdownToolbar } from '../src/ui/MarkdownToolbar';

const problem = (code: string, status: number, fields: object[] = []) =>
  HttpResponse.json(
    { code, fields },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

let stored: DraftDto = visualDraft(false);
const patches: { body: unknown; ifMatch: string | null }[] = [];
const noSelfCheck: QualityReportDto = {
  subject: { kind: 'draft', id: visualDraft(false).id, slug: null },
  bundleHash: 'a'.repeat(64),
  summary: emptySummary,
  current: null,
  latest: null,
  runs: [],
  can: { rerun: false },
};
let selfCheck: QualityReportDto = noSelfCheck;
const selfChecks: string[] = [];

function need<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture value missing');
  return value;
}

const server = setupServer(
  ...credibilityHandlers('*/api/v1'),
  http.get('*/api/v1/drafts/:id/self-check', () => HttpResponse.json(selfCheck)),
  http.post('*/api/v1/drafts/:id/self-check', ({ params }) => {
    selfChecks.push(String(params.id));
    const latest = { ...need(visualSelfCheck().latest), status: 'queued' as const, findings: [] };
    selfCheck = {
      ...noSelfCheck,
      latest,
      runs: [latest],
      summary: { ...emptySummary, status: 'queued' },
    };
    return HttpResponse.json(latest, { status: 202 });
  }),
  http.get('*/api/v1/meta', () => HttpResponse.json({ wikiName: 'Wiki', wikiDescription: '' })),
  http.get('*/api/v1/topics', () =>
    HttpResponse.json({
      items: [],
      nextCursor: null,
      counts: { open: 0, mine: 0, closed: 0, all: 0 },
    }),
  ),
  http.get('*/api/v1/auth/session', () => HttpResponse.json(visualSession)),
  http.get('*/api/v1/wiki/pages/:path', () => HttpResponse.json(visualPage)),
  http.post('*/api/v1/drafts', () => HttpResponse.json(stored)),
  http.get('*/api/v1/drafts/:id', () => HttpResponse.json(stored)),
  http.patch('*/api/v1/drafts/:id', async ({ request }) => {
    const body = (await request.json()) as Partial<DraftDto>;
    patches.push({ body, ifMatch: request.headers.get('If-Match') });
    stored = { ...stored, ...body, updatedAt: '2026-11-23T10:43:00.000Z' };
    return HttpResponse.json(stored);
  }),
  http.get('*/api/v1/me/suggestions', () => HttpResponse.json(visualSuggestions)),
);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  stored = visualDraft(false);
  patches.length = 0;
  selfCheck = noSelfCheck;
  selfChecks.length = 0;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function open(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<RouterProvider router={router} />);
  return router;
}

it('renders the F-06 frame regions and omits the ones without data (D-67)', async () => {
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Suggest an edit · Principle' }),
  ).toBeVisible();
  expect(
    screen.getByText('Draft saved 10:42 · editing from version 20261120-1 · section #principle'),
  ).toBeVisible();
  for (const name of ['Discard draft', 'Export .contribution.md', 'Whole page'])
    expect(screen.getByRole('button', { name })).toBeVisible();
  const editor = screen.getByRole('region', { name: 'Editor' });
  expect(
    within(editor)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['Write', 'Preview', 'Changes']);
  expect(
    within(within(editor).getByRole('toolbar', { name: 'Formatting' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Bold', 'Italic', 'Heading', 'Link', 'Footnote', 'Table']);
  expect(within(editor).getByLabelText('Markdown source')).toHaveValue(stored.content);
  expect(within(editor).getByText('1 line changed · 1 footnote added')).toBeVisible();
  expect(within(editor).getByText('Only #principle is in scope')).toBeVisible();
  const aside = screen.getByRole('complementary', { name: 'Submission' });
  expect(within(aside).getByLabelText('Reason (required)')).toHaveValue(stored.reason);
  expect(within(aside).getByText('sources/pawley-handbook.md')).toBeVisible();
  expect(within(aside).getByText('confocal-microscopy.md (target)')).toBeVisible();
  expect(
    await within(aside).findByText('A reviewer decides, or escalates to m.nguyen and h.pham'),
  ).toBeVisible();
  expect(within(aside).getByRole('button', { name: 'Submit proposal' })).toBeEnabled();
  expect(within(aside).getByText('Quality check (about 2 min)')).toBeVisible();
  // Self-check is a Phase 7 region (D-150); What happens to evidence is still Phase 9.
  expect(await within(aside).findByRole('button', { name: 'Run self-check' })).toBeEnabled();
  expect(within(aside).getByText('Advice only. It doesn’t block submitting.')).toBeVisible();
  expect(screen.queryByText(/What happens to evidence/u)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  await userEvent.click(within(editor).getByRole('tab', { name: 'Changes' }));
  const diff = within(editor).getByRole('list', { name: 'Changes' });
  expect(
    within(diff)
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual([
    '14−RemovedClosing the pinhole improves sectioning and reduces the detected signal.',
    '14+AddedClosing the pinhole below about 1 Airy unit (AU) gives little extra sectioning and reduces the detected signal.[^4]',
    '16+Added[^4]: sources/pawley-handbook.md, §2.4',
  ]);
});

it('shows the baseChanged banner and disables submit', async () => {
  stored = visualDraft(true);
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(
    'The page changed since you started. Version 20261123-2 touched #principle. Rebase before submitting; your text is kept.',
  );
  expect(within(alert).getByRole('button', { name: 'Compare and rebase' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Rebase before submitting' })).toBeDisabled();
});

it('offers Keep my text after SECTION_CHANGED and re-pins with keep_mine', async () => {
  stored = visualDraft(true);
  const modes: unknown[] = [];
  server.use(
    http.post('*/api/v1/drafts/:id/rebase', async ({ request }) => {
      const { mode } = (await request.json()) as { mode: string };
      modes.push(mode);
      if (mode === 'auto') return problem('SECTION_CHANGED', 409);
      stored = visualDraft(false);
      return HttpResponse.json(stored);
    }),
  );
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  await userEvent.click(await screen.findByRole('button', { name: 'Compare and rebase' }));
  const keep = await screen.findByRole('button', { name: 'Keep my text and rebase' });
  expect(screen.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('list', { name: 'Changes' })).toHaveTextContent('sharpens');
  await userEvent.click(keep);
  expect(await screen.findByRole('button', { name: 'Submit proposal' })).toBeEnabled();
  expect(modes).toEqual(['auto', 'keep_mine']);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('debounces autosave by 800 ms with If-Match; typing restarts the wait', async () => {
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  const reason = await screen.findByLabelText('Reason (required)');
  const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
  fireEvent.change(reason, { target: { value: 'New' } });
  expect(screen.getByText(/^Saving… · /u)).toBeVisible();
  await pause(500);
  fireEvent.change(reason, { target: { value: 'New reason' } });
  await pause(500);
  // 1000 ms after the first keystroke but only 500 ms after the last: nothing sent yet.
  expect(patches).toHaveLength(0);
  await screen.findByText(/^Draft saved 10:43/u, undefined, { timeout: 3000 });
  expect(patches).toEqual([{ body: { reason: 'New reason' }, ifMatch: '"2026-11-23T10:42:00Z"' }]);
  expect(reason).toHaveValue('New reason');
});

it('reloads on PRECONDITION_FAILED and keeps the input', async () => {
  server.use(http.patch('*/api/v1/drafts/:id', () => problem('PRECONDITION_FAILED', 409)));
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  const reason = await screen.findByLabelText('Reason (required)');
  fireEvent.change(reason, { target: { value: 'Mine' } });
  expect(await screen.findByRole('alert', undefined, { timeout: 3000 })).toHaveTextContent(
    'This has changed. Refresh and try again.',
  );
  expect(reason).toHaveValue('Mine');
});

it('submits and lands on Your suggestions; a reason error stays on the field', async () => {
  let attempt = 0;
  server.use(
    http.post('*/api/v1/drafts/:id/submit', ({ request }) => {
      expect(request.headers.get('If-Match')).toBe(`"${stored.updatedAt}"`);
      attempt++;
      if (attempt === 1)
        return problem('VALIDATION_FAILED', 400, [{ path: 'reason', code: 'REASON_REQUIRED' }]);
      return HttpResponse.json({ id: 'p', slug: 's' }, { status: 201 });
    }),
  );
  const router = open('/wiki/confocal-microscopy.md/edit?section=principle');
  await userEvent.click(await screen.findByRole('button', { name: 'Submit proposal' }));
  expect(await screen.findByText('Add a reason before submitting.')).toBeVisible();
  expect(screen.getByLabelText('Reason (required)')).toHaveAttribute('aria-invalid', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Submit proposal' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'You' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/me');
});

it('renders Your suggestions with its count and the D-69 rows', async () => {
  open('/me?tab=suggestions');
  expect(await screen.findByRole('tab', { name: 'Your suggestions 3' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    screen.getByText(
      'm.nguyen. Pages you follow, and what happened to your checks, reports and suggestions.',
    ),
  ).toBeVisible();
  const table = await screen.findByRole('table', { name: 'Your suggestions' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows.map((row) => within(row).getAllByRole('cell')[2]?.textContent)).toEqual([
    'Needs your attentionThe page changed under it',
    'Published',
    'DraftSaved 10:42',
  ]);
  expect(
    within(rows[2] as HTMLElement).getByRole('link', { name: 'Continue: Draft: pinhole units' }),
  ).toHaveAttribute('href', '/wiki/confocal-microscopy.md/edit?section=principle');
  // Phase 9 (F-05): the other tabs and the side cards.
  expect(screen.getByRole('tab', { name: /^Followed pages/u })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Tell me when' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Your part this year' })).toBeVisible();
});

it('F-05 lists followed pages, checks and reports, and saves preferences', async () => {
  const saved: unknown[] = [];
  server.use(
    http.put('*/api/v1/me/notification-preferences', async ({ request }) => {
      const body = await request.json();
      saved.push(body);
      return HttpResponse.json(body);
    }),
  );
  const router = open('/me');
  const follows = await screen.findByRole('table', { name: 'Followed pages' });
  expect(
    within(follows).getByRole('link', { name: 'Check again: Point spread function' }),
  ).toHaveAttribute('href', '/wiki/point-spread-function.md#table');
  await userEvent.click(screen.getByRole('tab', { name: /^Your checks and reports/u }));
  expect(router.state.location.search).toEqual({ tab: 'trust' });
  const activity = await screen.findByRole('table', { name: 'Your checks and reports' });
  expect(within(activity).getByText('“The table is for 20 °C; noted in the text.”')).toBeVisible();
  const weekly = await screen.findByRole('switch', { name: 'Weekly summary of followed pages' });
  await userEvent.click(weekly);
  expect(saved).toEqual([
    {
      events: {
        section_recheck: true,
        section_edited: true,
        report_outcome: true,
        weekly_summary: true,
      },
      channel: 'wiki',
    },
  ]);
});

it('shows the empty state when there are no suggestions', async () => {
  server.use(
    http.get('*/api/v1/me/suggestions', () =>
      HttpResponse.json({ items: [], nextCursor: null, total: 0 }),
    ),
  );
  open('/me?tab=suggestions');
  expect(await screen.findByText(/^No suggestions yet\./u)).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Your suggestions 0' })).toBeVisible();
});

it('DiffView and MarkdownToolbar expose roles and the empty state', async () => {
  const onFormat = vi.fn();
  render(
    <>
      <MarkdownToolbar onFormat={onFormat} />
      <DiffView rows={[]} />
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Footnote' }));
  expect(onFormat).toHaveBeenCalledWith('footnote');
  expect(screen.getByText('No changes yet.')).toBeVisible();
});

it('F-06 Self-check saves the draft, runs on it and shows findings, staleness and failures', async () => {
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  const aside = await screen.findByRole('complementary', { name: 'Submission' });
  const card = within(aside).getByRole('region', { name: 'Self-check AI' });
  expect(
    await within(card).findByText('Check your draft against the quality rules before you submit.'),
  ).toBeVisible();

  // An unsaved edit is flushed before the self-check, so the run checks what was typed.
  fireEvent.change(within(aside).getByLabelText('Reason (required)'), {
    target: { value: 'Airy units and the sectioning claim' },
  });
  await userEvent.click(within(card).getByRole('button', { name: 'Run self-check' }));
  expect(await within(card).findByText('Quality check queued.')).toBeVisible();
  expect(patches.at(-1)?.body).toEqual({ reason: 'Airy units and the sectioning claim' });
  expect(selfChecks).toEqual([stored.id]);
  expect(within(card).getByRole('button', { name: 'Run again' })).toBeDisabled();
  expect(card).toHaveAttribute('aria-busy', 'true');

  // The result arrives (SSE quality.changed {draftId} invalidates the report).
  selfCheck = visualSelfCheck();
  cleanup();
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  const fresh = within(await screen.findByRole('complementary', { name: 'Submission' }));
  const findings = await fresh.findByRole('list', { name: 'Findings' });
  expect(within(findings).getByRole('listitem')).toHaveTextContent(
    'Line 14 · medium · Adds a claim (“little extra sectioning”) that the reason doesn’t mention.“gives little extra sectioning”',
  );
  expect(fresh.getByRole('button', { name: 'Run again' })).toBeEnabled();

  // A newer autosave makes the run stale: the old findings are not shown as current.
  const report = visualSelfCheck();
  const stale = { ...need(report.latest), current: false };
  selfCheck = {
    ...report,
    current: null,
    latest: stale,
    runs: [stale],
    summary: { ...emptySummary, status: 'succeeded' },
  };
  cleanup();
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  expect(
    await screen.findByText(
      'You changed the draft since the last check. Run it again to check this version.',
    ),
  ).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Findings' })).not.toBeInTheDocument();

  // A failed run explains itself in words; a failed request shows the error copy.
  const failed = {
    ...need(report.latest),
    status: 'failed' as const,
    findings: [],
    error: { code: 'rate_limited', message: '429' },
  };
  selfCheck = { ...noSelfCheck, latest: failed, runs: [failed] };
  server.use(http.post('*/api/v1/drafts/:id/self-check', () => problem('VALIDATION_FAILED', 400)));
  cleanup();
  open('/wiki/confocal-microscopy.md/edit?section=principle');
  expect(
    await screen.findByText('The last check failed: the model provider is rate limiting requests.'),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Run again' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Check your input and try again.');
});
