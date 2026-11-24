import '@testing-library/jest-dom/vitest';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { visualSession } from '../src/dev/fixtures/reading';
import {
  adminPage,
  visualOwnerSession,
  visualTeams,
  visualTokens,
  visualUsers,
} from '../src/dev/fixtures/settings';
import { visualGates } from '../src/dev/fixtures/credibility';
import { visualModels, visualRules } from '../src/dev/fixtures/quality';
import { createAppRouter } from '../src/router';

const problem = (code: string, status: number, fields: string[] = []) =>
  HttpResponse.json(
    { code, fields: fields.map((path) => ({ path, code: 'invalid', message: 'x' })) },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

const adminCalls: string[] = [];
const server = setupServer(
  http.get('*/api/v1/meta', () => HttpResponse.json({ wikiName: 'Wiki', wikiDescription: '' })),
  http.get('*/api/v1/topics', () =>
    HttpResponse.json({
      items: [],
      nextCursor: null,
      counts: { open: 0, mine: 0, closed: 0, all: 0 },
    }),
  ),
  http.get('*/api/v1/auth/session', () => HttpResponse.json(visualOwnerSession)),
  http.all('*/api/v1/admin/*', ({ request }) => {
    adminCalls.push(`${request.method} ${new URL(request.url).pathname}`);
    return undefined;
  }),
  http.get('*/api/v1/admin/users', () => HttpResponse.json(adminPage(visualUsers))),
  http.get('*/api/v1/admin/teams', () => HttpResponse.json(adminPage(visualTeams))),
  http.get('*/api/v1/admin/tokens', () => HttpResponse.json(adminPage(visualTokens))),
  http.get('*/api/v1/admin/models', () => HttpResponse.json(visualModels)),
  http.get('*/api/v1/admin/rules', () => HttpResponse.json(visualRules)),
);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  server.resetHandlers();
  adminCalls.length = 0;
});

function open(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<RouterProvider router={router} />);
  return router;
}

it.each([
  ['a reviewer', visualSession, 'You do not have permission to do this.'],
  [
    'a reader',
    { ...visualSession, user: { ...visualSession.user, roles: ['reader'] } },
    'You do not have permission to do this.',
  ],
  ['nobody signed in', { user: null, csrfToken: null }, 'Sign in to continue.'],
])('gives %s no settings content (derived 403)', async (_, session, copy) => {
  server.use(http.get('*/api/v1/auth/session', () => HttpResponse.json(session)));
  open('/work/settings');
  expect(await screen.findByRole('alert')).toHaveTextContent(copy);
  expect(screen.queryByRole('tablist', { name: 'Settings' })).not.toBeInTheDocument();
  expect(adminCalls).toEqual([]);
});

it('renders the F-14 tabs and the People and teams rows for an owner', async () => {
  const user = userEvent.setup();
  const router = open('/work/settings');
  const tablist = await screen.findByRole('tablist', { name: 'Settings' });
  expect(
    within(tablist)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual([
    'Review and publishing',
    'Trust labels',
    'People and teams',
    'Agents and tokens',
    'Models',
    'Storage',
  ]);
  expect(screen.getByRole('tab', { name: 'People and teams' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    await screen.findByText('Imaging core, Light-sheet, Cell biology, Image analysis, +5'),
  ).toBeVisible();
  const people = screen.getByRole('table', { name: 'People' });
  expect(within(people).getAllByRole('row')).toHaveLength(visualUsers.length + 1);
  expect(within(people).getByText('a.perez').closest('tr')).toHaveTextContent('Disabled');

  screen.getByRole('tab', { name: 'People and teams' }).focus();
  await user.keyboard('{ArrowRight}');
  await waitFor(() => {
    expect(router.state.location.search).toEqual({ tab: 'agents' });
  });
  expect(await screen.findByText('Token …9f2a · scopes review, discuss')).toBeVisible();
});

it('renders no panel content for Storage (no data yet)', async () => {
  open('/work/settings?tab=storage');
  const tab = await screen.findByRole('tab', { name: 'Storage', selected: true });
  const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
  expect(panel).toBeEmptyDOMElement();
  expect(adminCalls).toEqual([]);
});

it('Trust labels: a gate needs a run record and date to turn on (§7.7.10)', async () => {
  const puts: unknown[] = [];
  server.use(
    http.get('*/api/v1/admin/credibility-gates', () => HttpResponse.json(visualGates)),
    http.put('*/api/v1/admin/credibility-gates/:capability', async ({ params, request }) => {
      const body = (await request.json()) as { enabled: boolean };
      puts.push({ capability: params.capability, ...body });
      const gate = visualGates.items.find(({ capability }) => capability === params.capability);
      return HttpResponse.json({ ...gate, ...body });
    }),
  );
  open('/work/settings?tab=trust');
  const user = userEvent.setup();
  expect(await screen.findByText('Order re-checks by score')).toBeVisible();
  const [first] = screen.getAllByRole('button', { name: 'Turn on…' });
  if (!first) throw new Error('no gate');
  await user.click(first);
  await user.click(screen.getByRole('button', { name: 'Turn on' }));
  expect(await screen.findByText('Enter the experiment run record.')).toBeVisible();
  expect(puts).toEqual([]);
  await user.type(screen.getByLabelText('Run record'), 'experiments/runs/e8d/2026-11-01.json');
  await user.type(screen.getByLabelText('Result date'), '2026-11-01');
  await user.click(screen.getByRole('button', { name: 'Turn on' }));
  await waitFor(() => {
    expect(puts).toEqual([
      {
        capability: 'label_threshold',
        enabled: true,
        runRecord: 'experiments/runs/e8d/2026-11-01.json',
        runDate: '2026-11-01',
      },
    ]);
  });
});

it('Models tab shows the effective model config, local endpoint and quality rules (read-only)', async () => {
  open('/work/settings?tab=models');
  await screen.findByRole('tab', { name: 'Models', selected: true });
  expect(await screen.findByText('Quality check')).toBeVisible();
  expect(screen.getByText('claude-sonnet-5-5')).toBeVisible();
  expect(
    screen.getByText(
      'anthropic · up to 4096 tokens · 120 s timeout · 3 attempts · default model. Last used claude-sonnet-5-5 · quality-v1, 23 Nov 2026, 10:07 UTC.',
    ),
  ).toBeVisible();
  expect(screen.getByText('http://models.internal:8000')).toBeVisible();
  expect(screen.getByText('rules/quality.md')).toBeVisible();
  expect(screen.getByText('6 rules · version 3f2a91 · 3969 bytes')).toBeVisible();
  const rules = screen.getByRole('list', { name: 'Quality rules' });
  expect(within(rules).getAllByRole('listitem')[0]).toHaveTextContent(
    'Claim without evidence · unsourced-claim',
  );
  // Read-only: nothing to edit or save on this tab (D-140).
  const tab = screen.getByRole('tab', { name: 'Models' });
  const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
  expect(within(panel as HTMLElement).queryAllByRole('button')).toEqual([]);
  expect(adminCalls).toEqual(
    expect.arrayContaining(['GET /api/v1/admin/models', 'GET /api/v1/admin/rules']),
  );
});

it('Models tab reports an unusable rules file and a failed request', async () => {
  server.use(
    http.get('*/api/v1/admin/rules', () =>
      HttpResponse.json({ ...visualRules, error: 'no rules', rules: [], sha256: null }),
    ),
  );
  open('/work/settings?tab=models');
  expect(
    await screen.findByText('Not usable: no rules. Quality checks fail until the file is fixed.'),
  ).toBeVisible();
  cleanup();
  server.use(http.get('*/api/v1/admin/models', () => problem('INTERNAL', 500)));
  open('/work/settings?tab=models');
  expect(await screen.findByText('Something went wrong. Try again.')).toBeVisible();
});

it('shows EMAIL_TAKEN under the email field and validates before sending', async () => {
  const user = userEvent.setup();
  let body: unknown;
  server.use(
    http.post('*/api/v1/admin/users', async ({ request }) => {
      body = await request.json();
      return problem('EMAIL_TAKEN', 409);
    }),
  );
  open('/work/settings');
  const form = await screen.findByRole('form', { name: 'Add a person' });
  await user.click(within(form).getByRole('button', { name: 'Add person' }));
  expect(within(form).getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
  expect(body).toBeUndefined();

  await user.type(within(form).getByLabelText('Name'), 'Ana');
  await user.type(within(form).getByLabelText('Email'), 'mn@example.test');
  await user.selectOptions(within(form).getByLabelText('Team'), 'Histology');
  await user.click(within(form).getByRole('checkbox', { name: 'contributor' }));
  await user.click(within(form).getByRole('button', { name: 'Add person' }));
  const email = within(form).getByLabelText('Email');
  await waitFor(() => {
    expect(email).toHaveAttribute('aria-invalid', 'true');
  });
  expect(email).toHaveAccessibleDescription('This email address is already in use.');
  expect(body).toEqual({
    name: 'Ana',
    email: 'mn@example.test',
    roles: ['reader', 'contributor'],
    teamId: visualTeams[8]?.id,
  });
});

it('shows LAST_OWNER when disabling the only owner', async () => {
  const user = userEvent.setup();
  server.use(http.patch('*/api/v1/admin/users/:id', () => problem('LAST_OWNER', 409)));
  open('/work/settings');
  await user.click(await screen.findByRole('button', { name: 'Disable m.nguyen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'At least one owner must be able to sign in.',
  );
});

it('edits roles and team and sends only the changes', async () => {
  const user = userEvent.setup();
  let body: unknown;
  server.use(
    http.patch('*/api/v1/admin/users/:id', async ({ request, params }) => {
      body = { id: params.id, ...((await request.json()) as object) };
      return HttpResponse.json({ ...visualUsers[2], roles: ['reader', 'contributor'] });
    }),
  );
  open('/work/settings');
  await user.click(await screen.findByRole('button', { name: 'Edit l.tran' }));
  const form = screen.getByRole('form', { name: 'Edit l.tran' });
  await user.click(within(form).getByRole('checkbox', { name: 'contributor' }));
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(screen.queryByRole('form', { name: 'Edit l.tran' })).not.toBeInTheDocument();
  });
  expect(body).toEqual({ id: visualUsers[2]?.id, roles: ['reader', 'contributor'] });
});

it('creates a team and reports a duplicate name', async () => {
  const user = userEvent.setup();
  server.use(http.post('*/api/v1/admin/teams', () => problem('ALREADY_EXISTS', 409)));
  open('/work/settings');
  const form = await screen.findByRole('form', { name: 'Add a team' });
  await user.type(within(form).getByLabelText('Team name'), 'Histology');
  await user.click(within(form).getByRole('button', { name: 'Add team' }));
  await waitFor(() => {
    expect(within(form).getByLabelText('Team name')).toHaveAccessibleDescription(
      'This already exists.',
    );
  });
});

it('creates a token, shows its secret once, and revokes a token', async () => {
  const user = userEvent.setup();
  let created: unknown;
  let revoked: unknown;
  server.use(
    http.post('*/api/v1/admin/tokens', async ({ request }) => {
      created = await request.json();
      return HttpResponse.json(
        { ...visualTokens[1], id: 'new', name: 'ci', token: 'mwt_abcd1234_secret' },
        { status: 201 },
      );
    }),
    http.delete('*/api/v1/admin/tokens/:id', ({ params }) => {
      revoked = params.id;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  open('/work/settings?tab=agents');
  const form = await screen.findByRole('form', { name: 'Create a token' });
  await user.type(within(form).getByLabelText('What it is for'), 'ci');
  await user.selectOptions(within(form).getByLabelText('Account'), 'lab-agent (agent)');
  // A contributor account cannot be given review or publish scopes.
  expect(within(form).queryByRole('checkbox', { name: 'review' })).not.toBeInTheDocument();
  await user.click(within(form).getByRole('checkbox', { name: 'contribute' }));
  await user.click(within(form).getByRole('button', { name: 'Create token' }));
  const status = await within(form).findByRole('status');
  expect(status).toHaveTextContent('mwt_abcd1234_secret');
  expect(created).toEqual({ name: 'ci', userId: visualUsers[5]?.id, scopes: ['contribute'] });
  await user.click(within(status).getByRole('button', { name: 'Done' }));
  expect(screen.queryByText('mwt_abcd1234_secret')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Revoke token Decides proposals.' }));
  await user.click(screen.getByRole('button', { name: 'Revoke token' }));
  await waitFor(() => {
    expect(revoked).toBe(visualTokens[0]?.id);
  });
});
