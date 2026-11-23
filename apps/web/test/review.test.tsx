import '@testing-library/jest-dom/vitest';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { visualSession } from '../src/dev/fixtures/reading';
import {
  visualAudit,
  visualBlocked,
  visualConflictProposal,
  visualDiff,
  visualProposal,
  visualProposalList,
} from '../src/dev/fixtures/review';
import { visualOwnerSession } from '../src/dev/fixtures/settings';
import type { ProposalDetailDto } from '../src/features/review/model';
import { startingText } from '../src/features/conflict/model';
import { createAppRouter } from '../src/router';

function need<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture value missing');
  return value;
}

const problem = (code: string, status: number) =>
  HttpResponse.json({ code }, { status, headers: { 'Content-Type': 'application/problem+json' } });

const requests: { path: string; body: unknown; tab?: string | null }[] = [];
let session: object = visualSession;
let detail: ProposalDetailDto = visualProposal('fix-pinhole-units', null);
let blocked = visualBlocked;
const server = setupServer(
  http.get('*/api/v1/meta', () => HttpResponse.json({ wikiName: 'Wiki', wikiDescription: '' })),
  http.get('*/api/v1/auth/session', () => HttpResponse.json(session)),
  http.get('*/api/v1/proposals', ({ request }) => {
    const tab = new URL(request.url).searchParams.get('tab');
    requests.push({ path: 'list', body: null, tab });
    return HttpResponse.json(visualProposalList(tab));
  }),
  http.get('*/api/v1/proposals/:slug', ({ params }) =>
    HttpResponse.json(params.slug === 'detector-table' ? visualConflictProposal : detail),
  ),
  http.get('*/api/v1/proposals/:slug/diff', () => HttpResponse.json(visualDiff())),
  http.get('*/api/v1/ops/blocked', () => HttpResponse.json(blocked)),
  http.get('*/api/v1/audit', () => HttpResponse.json(visualAudit)),
);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  requests.length = 0;
  session = visualSession;
  detail = visualProposal('fix-pinhole-units', null);
  blocked = visualBlocked;
  sessionStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});

function open(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<RouterProvider router={router} />);
  return router;
}

it('F-09 lists proposals with tab counts, keeps the tab in the URL and filters rows', async () => {
  const router = open('/work/proposals');
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { level: 1, name: 'Proposals' })).toBeVisible();
  const tabs = within(screen.getByRole('tablist', { name: 'State' }));
  expect(await tabs.findByRole('tab', { name: 'Open 4' })).toHaveAttribute('aria-selected', 'true');
  expect(tabs.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Open 4',
    'Stale 1',
    'Blocked 1',
    'Published 51',
    'Rejected 7',
    'All 64',
  ]);
  const table = await screen.findByRole('table', { name: 'Proposals' });
  expect(within(table).getByRole('link', { name: 'fix-pinhole-units' })).toHaveAttribute(
    'href',
    '/work/proposals/fix-pinhole-units',
  );
  // WorkNav shows the open count where data exists (D-95).
  const nav = screen.getByRole('navigation', { name: 'Workspace' });
  expect(within(nav).getByRole('link', { name: /Proposals/u })).toHaveTextContent('Proposals 4');
  // Regions without Phase 5 data are not rendered (D-97).
  expect(screen.queryByRole('columnheader', { name: 'Quality' })).not.toBeInTheDocument();
  expect(screen.queryByText('Import .contribution.md')).not.toBeInTheDocument();

  // Keyboard: arrow keys move between tabs (Tabs component), and the URL follows.
  tabs.getByRole('tab', { name: 'Open 4' }).focus();
  await user.keyboard('{ArrowRight}{ArrowRight}');
  expect(tabs.getByRole('tab', { name: 'Blocked 1' })).toHaveFocus();
  expect(router.state.location.search).toEqual({ tab: 'blocked' });
  const blockedTable = await screen.findByRole('table', { name: 'Proposals' });
  expect(await within(blockedTable).findByText('Owner (investigate)')).toBeVisible();
  expect(requests.some(({ tab }) => tab === 'blocked')).toBe(true);

  await user.click(tabs.getByRole('tab', { name: 'All 64' }));
  await screen.findByText('na-table-typo');
  await user.type(need(screen.getAllByRole('searchbox', { name: 'Filter' })[0]), 'h.pham');
  const rows = within(screen.getByRole('table', { name: 'Proposals' })).getAllByRole('row');
  expect(rows.slice(1).map((row) => within(row).getAllByRole('link')[0]?.textContent)).toEqual([
    'detector-table',
    'deconv-iterations',
  ]);
});

it('F-10 sends the preview binding with the decision and keeps the reason on a lock', async () => {
  const decisions: unknown[] = [];
  let calls = 0;
  server.use(
    http.post('*/api/v1/proposals/:slug/decisions', async ({ request }) => {
      decisions.push(await request.json());
      calls++;
      if (calls === 1) return problem('DISCUSSION_CHANGED', 409);
      const published: ProposalDetailDto = {
        ...visualProposal('fix-pinhole-units', 'publishing'),
        state: 'published',
        tab: 'published',
        publication: {
          ...need(visualProposal('fix-pinhole-units', 'publishing').publication),
          phase: 'done',
          versionLabel: '20261123-3',
        },
      };
      detail = published;
      return HttpResponse.json(published, { status: 201 });
    }),
  );
  open('/work/proposals/fix-pinhole-units');
  const user = userEvent.setup();
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Pinhole units and sectioning' }),
  ).toBeVisible();
  const panel = screen.getByRole('region', { name: 'Decision' });
  expect(
    within(panel).getByText(
      'Bound to bundle a1f3c9e2 · artifact 9c0e57b1 · preview 10:31 · discussion v1 · dispute v0',
    ),
  ).toBeVisible();
  // Changes: context lines, a collapsed run and the section heading.
  expect(
    await screen.findByText('Section Principle · 2 lines added, 1 line removed'),
  ).toBeVisible();
  expect(screen.getByText('20 unchanged lines')).toBeVisible();
  // Escalation/Agent review/Quality check are later phases (not rendered).
  expect(screen.queryByRole('heading', { name: /Agent review|Quality check|Escalation/u })).toBe(
    null,
  );

  // Reason is required.
  await user.click(within(panel).getByRole('button', { name: 'Approve and publish' }));
  expect(within(panel).getByText('Give a reason for your decision.')).toBeVisible();
  expect(decisions).toHaveLength(0);

  await user.click(within(panel).getByRole('radio', { name: /Request changes/u }));
  expect(within(panel).getByRole('button', { name: 'Send back with reason' })).toBeVisible();
  await user.click(within(panel).getByRole('radio', { name: /Approve and publish/u }));
  await user.type(within(panel).getByLabelText('Reason (required)'), 'Checked §2.4.');
  await user.click(within(panel).getByRole('button', { name: 'Approve and publish' }));
  expect(decisions[0]).toEqual({
    approve: true,
    reason: 'Checked §2.4.',
    ...detail.preview?.binding,
  });

  // Locked scenario: banner, disabled submit, the reason stays.
  const banner = await screen.findByRole('status');
  expect(banner).toHaveTextContent(
    'New discussion entry. Reread before deciding. Your reason is kept.',
  );
  expect(within(panel).getByRole('button', { name: 'Reread before deciding' })).toBeDisabled();
  expect(within(panel).getByLabelText('Reason (required)')).toHaveValue('Checked §2.4.');
  expect(sessionStorage.getItem('mw:form:review:fix-pinhole-units')).toBe('Checked §2.4.');

  await user.click(within(banner).getByRole('button', { name: 'Reload' }));
  const submit = await within(panel).findByRole('button', { name: 'Approve and publish' });
  expect(submit).toBeEnabled();
  await user.click(submit);
  expect(decisions).toHaveLength(2);
  expect(await screen.findByText('Version 20261123-3 is on the page.')).toBeVisible();
  const progress = screen.getByRole('list', { name: 'Publish progress' });
  expect(
    within(progress)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['✓ Verified', '✓ Writing', '✓ Written', '✓ Done']);
  expect(sessionStorage.getItem('mw:form:review:fix-pinhole-units')).toBeNull();
});

it('F-10 shows publish progress while publishing and the blocked banner', async () => {
  detail = visualProposal('fix-pinhole-units', 'publishing');
  open('/work/proposals/fix-pinhole-units');
  expect(await screen.findByText(/Publishing automatically\./u)).toBeVisible();
  const progress = screen.getByRole('list', { name: 'Publish progress' });
  expect(
    within(progress)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['✓ Verified', 'Writing…', 'Written', 'Done']);
  expect(within(progress).getByText('Writing…')).toHaveAttribute('aria-current', 'step');
  cleanup();

  detail = visualProposal('deconv-iterations', null);
  open('/work/proposals/deconv-iterations');
  const banner = await screen.findByRole('status');
  expect(banner).toHaveTextContent('Publish outcome unknown.');
  expect(within(banner).getByRole('link', { name: 'Investigate in Operations' })).toHaveAttribute(
    'href',
    '/work/ops',
  );
});

it('F-10 renders Final page, Current page and History tabs (D-16)', async () => {
  open('/work/proposals/fix-pinhole-units');
  const user = userEvent.setup();
  const content = await screen.findByRole('region', { name: 'Content' });
  await user.click(within(content).getByRole('tab', { name: 'Final page' }));
  expect(await within(content).findByRole('heading', { name: 'Principle' })).toBeVisible();
  expect(content).not.toHaveTextContent('md-wiki:status');
  await user.click(within(content).getByRole('tab', { name: 'Current page' }));
  expect(
    within(within(content).getByRole('tabpanel', { name: 'Current page' })).getByText(
      /A laser is scanned/u,
    ),
  ).toBeVisible();
  await user.click(within(content).getByRole('tab', { name: 'History (2)' }));
  expect(within(content).getByText('Submitted by lab-agent')).toBeVisible();
});

it('F-13 resolves a blocked target with evidence and refreshes the list (blocked flow, MSW)', async () => {
  session = visualOwnerSession;
  const resolutions: unknown[] = [];
  server.use(
    http.post('*/api/v1/ops/blocked/:slug/resolution', async ({ request, params }) => {
      resolutions.push({ slug: params.slug, body: await request.json() });
      blocked = { items: [] };
      return HttpResponse.json({
        ...visualProposal('deconv-iterations', null),
        state: 'published',
      });
    }),
  );
  open('/work/ops');
  const user = userEvent.setup();
  const section = await screen.findByRole('region', { name: 'Blocked: deconvolution.md' });
  expect(
    within(section).getByText('File hash on disk 7b21e0c4 · expected new 7b21e0c4 · old 3f90aa12'),
  ).toBeVisible();
  const nav = screen.getByRole('navigation', { name: 'Workspace' });
  await waitFor(() => {
    expect(within(nav).getByRole('link', { name: /Operations/u })).toHaveTextContent(
      /Operations\s*1/u,
    );
  });

  await user.click(
    within(section).getByRole('button', { name: 'On disk = the new version (mark published)' }),
  );
  expect(within(section).getByText('Say what you checked on disk.')).toBeVisible();
  expect(resolutions).toHaveLength(0);
  await user.type(within(section).getByLabelText('What you checked (required)'), 'sha matches');
  await user.click(
    within(section).getByRole('button', { name: 'On disk = the new version (mark published)' }),
  );
  expect(resolutions).toEqual([
    { slug: 'deconv-iterations', body: { outcome: 'written', evidence: 'sha matches' } },
  ]);
  expect(await screen.findByText('0', { selector: 'span' }, { timeout: 2000 })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Blocked: deconvolution.md' })).toBeNull();
});

it('F-13 shows a resolution error and keeps the evidence', async () => {
  session = visualOwnerSession;
  server.use(
    http.post('*/api/v1/ops/blocked/:slug/resolution', () => problem('PRECONDITION_FAILED', 409)),
  );
  open('/work/ops');
  const user = userEvent.setup();
  const section = await screen.findByRole('region', { name: 'Blocked: deconvolution.md' });
  await user.type(within(section).getByLabelText('What you checked (required)'), 'old bytes');
  await user.click(within(section).getByRole('button', { name: 'Neither (restore from backup)' }));
  expect(await within(section).findByRole('alert')).toHaveTextContent(
    'This has changed. Refresh and try again.',
  );
  expect(within(section).getByLabelText('What you checked (required)')).toHaveValue('old bytes');
});

it('Audit log is a derived owner screen linked from Operations', async () => {
  session = visualOwnerSession;
  open('/work/ops/audit');
  const table = await screen.findByRole('table', { name: 'Audit log' });
  expect(within(table).getByText('publication.unknown')).toBeVisible();
  expect(within(table).getByText('m.nguyen')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Operations', current: false })).toBeVisible();
});

it('F-07 maps the choices to the conflict endpoint and confirms the new proposal', async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post('*/api/v1/proposals/:slug/conflict', async ({ request }) => {
      const body = (await request.json()) as { outcome: string };
      bodies.push(body);
      return HttpResponse.json(
        {
          resolution: {
            outcome: body.outcome,
            actor: { id: 'x', name: 'h.pham', kind: 'human' },
            reason: 'r',
            baseSha256: null,
            currentSha256: null,
            replacementSlug: body.outcome === 'keep_current' ? null : 'detector-table-2',
            createdAt: '2026-11-23T12:00:00Z',
          },
          replacement:
            body.outcome === 'keep_current'
              ? null
              : { ...visualConflictProposal, slug: 'detector-table-2' },
        },
        { status: 201 },
      );
    }),
  );
  open('/me/suggestions/detector-table/resolve');
  const user = userEvent.setup();
  expect(
    await screen.findByText(
      'You read 20261120-1 · now 20261123-2 (lightsheet-lead-2) · section #detectors',
    ),
  ).toBeVisible();
  for (const name of ['What you read', 'What changed since', 'Your proposal'])
    expect(screen.getByRole('region', { name })).toBeVisible();
  const editor = screen.getByLabelText('Merged section text');
  expect(editor).toHaveValue(startingText('merge', need(visualConflictProposal.conflict)));
  // Stale proposals cannot be withdrawn (can.withdraw is false).
  expect(screen.queryByRole('button', { name: 'Withdraw proposal' })).toBeNull();

  await user.click(screen.getByRole('radio', { name: /Drop my change/u }));
  expect(editor).toHaveAttribute('readonly');
  await user.clear(screen.getByLabelText('Reason'));
  await user.click(screen.getByRole('button', { name: 'Withdraw with reason' }));
  expect(screen.getByText('Give a reason.')).toBeVisible();
  expect(bodies).toHaveLength(0);
  await user.type(screen.getByLabelText('Reason'), 'Current text is enough');
  await user.click(screen.getByRole('button', { name: 'Withdraw with reason' }));
  expect(bodies).toEqual([{ outcome: 'keep_current', reason: 'Current text is enough' }]);
  expect(await screen.findByText('Your change was dropped.')).toBeVisible();
});

it('F-07 submits Replace with mine as use_incoming with the edited text', async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post('*/api/v1/proposals/:slug/conflict', async ({ request }) => {
      bodies.push(await request.json());
      return problem('NO_CHANGE', 400);
    }),
  );
  open('/me/suggestions/detector-table/resolve');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: /Replace with mine/u }));
  const editor = screen.getByLabelText('Merged section text');
  expect(editor).toHaveValue(need(visualConflictProposal.conflict).proposedText);
  await user.type(editor, 'more');
  await user.click(screen.getByRole('button', { name: 'Submit as new proposal' }));
  expect(bodies).toEqual([
    {
      outcome: 'use_incoming',
      reason: visualConflictProposal.reason,
      replacement: `${need(visualConflictProposal.conflict).proposedText}more`,
    },
  ]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  expect(editor).toHaveValue(`${need(visualConflictProposal.conflict).proposedText}more`);
});
