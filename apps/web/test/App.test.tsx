import '@testing-library/jest-dom/vitest';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  visualHistory,
  visualPage,
  visualPageTopic,
  visualSession,
} from '../src/dev/fixtures/reading';
import { createAppRouter } from '../src/router';

const server = setupServer(
  http.get('*/api/v1/meta', () =>
    HttpResponse.json({ wikiName: 'A runtime wiki', wikiDescription: '' }),
  ),
  http.get('*/api/v1/auth/session', () => HttpResponse.json(visualSession)),
  http.get('*/api/v1/wiki/pages/:path', () => HttpResponse.json(visualPage)),
  http.get('*/api/v1/wiki/pages/:path/history', () => HttpResponse.json(visualHistory)),
  http.get('*/api/v1/wiki/tree', () => HttpResponse.json({ topics: [visualPageTopic] })),
);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
});

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.restoreAllMocks();
});

function open(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<RouterProvider router={router} />);
  return router;
}

it.each([
  ['/', '/', 'Home'],
  ['/#recent', '/', 'Recent changes'],
  ['/search?q=pinhole+size', '/search', null],
  ['/wiki/microscopy/%E6%96%87%20%E5%AD%97.md/edit?section=overview', '/wiki/{$}/edit', null],
  ['/me', '/me', 'MN — You: followed pages and your activity'],
  ['/me/suggestions/example-id/resolve', '/me/suggestions/$id/resolve', null],
])('uses the empty reading screen for %s', async (path, id, active) => {
  const router = open(path);
  const main = await screen.findByRole('main');
  expect(main).toHaveTextContent(/^$/);
  expect(router.state.matches.at(-1)?.routeId).toBe(id);
  expect(screen.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument();
  await screen.findByText('A runtime wiki');
  const banner = screen.getByRole('banner');
  if (active)
    expect(within(banner).getByRole('link', { name: active, current: 'page' })).toBeVisible();
  else expect(within(banner).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
});

it.each([
  ['/work', '/work', 'Inbox'],
  ['/work/proposals', '/work/proposals', 'Proposals'],
  ['/work/proposals/clarify-units', '/work/proposals/$slug', 'Proposals'],
  ['/work/discussions', '/work/discussions', 'Discussions'],
  ['/work/credibility', '/work/credibility', 'Credibility'],
  ['/work/ops', '/work/ops', 'Operations'],
  ['/work/settings', '/work/settings', 'Settings'],
])('uses the empty workspace screen for %s', async (path, id, active) => {
  const router = open(path);
  expect(await screen.findByRole('main')).toBeEmptyDOMElement();
  expect(router.state.matches.at(-1)?.routeId).toBe(id);
  expect(
    within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', {
      name: active,
      current: 'page',
    }),
  ).toBeVisible();
  expect(
    await within(screen.getByRole('banner')).findByRole('link', {
      name: 'Workspace',
      current: 'page',
    }),
  ).toBeVisible();
});

it.each(['', '123', 'null', '"quoted"', '日本語 & | ! :*', 'a'.repeat(201)])(
  'keeps the literal search query: %s',
  async (q) => {
    const path = `/search?${new URLSearchParams({ q })}`;
    const router = open(path);
    expect(await screen.findByRole('searchbox')).toHaveValue(q);
    expect(router.history.location.href).toBe(path);
  },
);

it('captures the whole nested wiki path separately from the editor suffix and section', async () => {
  const router = open('/wiki/lab-notes/example/%C3%A9.md/edit?section=123');
  await screen.findByRole('main');
  const match = router.state.matches.at(-1);
  expect(match?.params).toMatchObject({ _splat: 'lab-notes/example/é.md' });
  expect(match?.search).toEqual({ section: '123' });
});

const problem = (code: string, status: number, headers: Record<string, string> = {}) =>
  HttpResponse.json(
    { code },
    { status, headers: { ...headers, 'Content-Type': 'application/problem+json' } },
  );

it('loads a nested wiki path as one API parameter and renders the requested section anchor', async () => {
  const expectedPath = 'microscopy/basics.md';
  const read = vi.fn(({ params }: { params: Record<string, unknown> }) => {
    expect(params.path).toBe(expectedPath);
    return HttpResponse.json({ ...visualPage, path: expectedPath });
  });
  server.use(http.get('*/api/v1/wiki/pages/:path', read));
  const router = open(`/wiki/${expectedPath}#principle`);
  expect(await screen.findByRole('region', { name: 'Principle' })).toHaveAttribute(
    'id',
    'principle',
  );
  expect(router.state.matches.at(-1)?.params).toMatchObject({ _splat: expectedPath });
  expect(read).toHaveBeenCalled();
  expect(scrollIntoView).toHaveBeenCalled();
});

it('shows page and section labels, follows section anchors and omits deferred regions', async () => {
  const tree = vi.fn(({ request }: { request: Request }) => {
    expect(new URL(request.url).searchParams.get('topic')).toBe(visualPage.topic.id);
    return HttpResponse.json({ topics: [visualPageTopic] });
  });
  server.use(http.get('*/api/v1/wiki/tree', tree));
  const router = open(`/wiki/${visualPage.path}`);
  const nav = await screen.findByRole('navigation', { name: 'Pages and contents' });
  expect(
    await within(nav).findByRole('link', {
      name: 'Confocal microscopy: Under re-check',
      current: 'page',
    }),
  ).toBeVisible();
  expect(tree).toHaveBeenCalled();
  const principle = within(nav).getByRole('link', { name: 'Principle: Under re-check' });
  expect(principle).toHaveAttribute('aria-current', 'location');
  expect(router.history.location.href).toBe(`/wiki/${visualPage.path}`);
  const overview = within(nav).getByRole('link', { name: 'Overview: Reviewed' });
  await userEvent.setup().click(overview);
  expect(overview).toHaveAttribute('aria-current', 'location');
  expect(principle).not.toHaveAttribute('aria-current');
  expect(router.history.location.href).toBe(`/wiki/${visualPage.path}#overview`);
  const article = screen.getByRole('article', { name: visualPage.title });
  expect(within(article).getByText('1 section under re-check')).toBeVisible();
  expect(within(article).getByRole('img', { name: /5 sections/ })).toBeVisible();
  const note = within(article).getByRole('note');
  expect(note).toHaveTextContent(visualPage.sections[1]?.warn?.reason ?? 'missing reason');
  expect(within(note).getByRole('link', { name: 'See the proposed fix' })).toHaveAttribute(
    'href',
    '/work/proposals/confocal-pinhole-wording',
  );
  expect(within(article).getByRole('link', { name: 'History' })).toHaveAttribute(
    'href',
    `/wiki/${visualPage.path}/history`,
  );
  expect(
    within(article).queryByText(
      /^(Follow|Suggest an edit|Ask a question|Sources|Changed outside review|Did this page help with your work\?|This section:)$/u,
    ),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'About this page' })).not.toBeInTheDocument();
});

it.each(['click', 'Enter', 'Space'] as const)(
  'selects a section with the heading TrustBadge by %s without opening the Why rail',
  async (input) => {
    const url = `/wiki/${visualPage.path}?section=overview`;
    const router = open(`${url}#overview`);
    const article = await screen.findByRole('article', { name: visualPage.title });
    const nav = screen.getByRole('navigation', { name: 'Pages and contents' });
    const overview = within(nav).getByRole('link', { name: 'Overview: Reviewed' });
    expect(overview).toHaveAttribute('aria-current', 'location');
    const region = within(article).getByRole('region', { name: 'Resolution' });
    const badge = within(region).getByRole('button', {
      name: /^Resolution: Checked against source/u,
    });
    const user = userEvent.setup();
    if (input === 'click') {
      await user.click(badge);
    } else {
      badge.focus();
      await user.keyboard(input === 'Enter' ? '{Enter}' : ' ');
    }
    expect(router.history.location.href).toBe(`${url}#resolution`);
    expect(badge).toHaveFocus();
    expect(region).toHaveClass('bg-subtle-section');
    expect(overview).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: /^Resolution:/u })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'About this page' }),
    ).not.toBeInTheDocument();
  },
);

it('opens nested History, loads cursor pages and retries without dropping existing versions', async () => {
  const path = 'microscopy/Guide 文.md';
  const pageUrl = '/wiki/microscopy/Guide%20%E6%96%87.md';
  const cursor = 'test+opaque/=cursor';
  const [first] = visualHistory.items;
  if (!first) throw new Error('Missing history fixture');
  const older = { ...first, versionLabel: '20261122-1' };
  let attempts = 0;
  const read = vi.fn(
    ({ params, request }: { params: Record<string, unknown>; request: Request }) => {
      expect(params.path).toBe(path);
      const value = new URL(request.url).searchParams.get('cursor');
      if (value == null) return HttpResponse.json({ ...visualHistory, nextCursor: cursor });
      expect(value).toBe(cursor);
      if (++attempts === 1) return problem('STORAGE_ERROR', 500);
      return HttpResponse.json({ items: [older], nextCursor: null });
    },
  );
  server.use(
    http.get('*/api/v1/wiki/pages/:path', ({ params }) => {
      expect(params.path).toBe(path);
      return HttpResponse.json({ ...visualPage, path });
    }),
    http.get('*/api/v1/wiki/pages/:path/history', read),
  );
  const router = open(pageUrl);
  const user = userEvent.setup();
  const historyLink = await screen.findByRole('link', { name: 'History' });
  expect(historyLink).toHaveAttribute('href', `${pageUrl}/history`);
  await user.click(historyLink);
  expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeVisible();
  expect(router.state.matches.at(-1)?.params).toMatchObject({ _splat: path });
  const table = await screen.findByRole('table', { name: 'Versions' });
  expect(within(table).getByText(visualPage.versionLabel)).toHaveClass('font-mono');
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The wiki storage is unavailable.');
  expect(within(table).getByText(visualPage.versionLabel)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await within(table).findByText(older.versionLabel)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(3);
  await user.click(
    within(screen.getByRole('article', { name: 'History' })).getByRole('link', {
      name: visualPage.title,
    }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: visualPage.title })).toBeVisible();
});

it('keeps page content readable when the topic tree fails and can retry into an empty tree', async () => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get('*/api/v1/wiki/tree', async () => {
      await pending;
      return problem('STORAGE_ERROR', 500);
    }),
  );
  open(`/wiki/${visualPage.path}`);
  const nav = await screen.findByRole('navigation', { name: 'Pages and contents' });
  expect(within(nav).getByRole('region', { name: visualPage.topic.name })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  release();
  expect(await within(nav).findByRole('alert')).toHaveTextContent(
    'The wiki storage is unavailable.',
  );
  expect(screen.getByRole('article', { name: visualPage.title })).toBeVisible();
  server.use(http.get('*/api/v1/wiki/tree', () => HttpResponse.json({ topics: [] })));
  await userEvent.setup().click(within(nav).getByRole('button', { name: 'Try again' }));
  expect(await within(nav).findByText('No pages in this topic.')).toBeVisible();
  expect(within(nav).getByRole('link', { name: 'Principle: Under re-check' })).toBeVisible();
});

it('shows an approved loading card then a neutral empty state for History', async () => {
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  server.use(
    http.get('*/api/v1/wiki/pages/:path/history', async () => {
      await pending;
      return HttpResponse.json({ items: [], nextCursor: null });
    }),
  );
  open(`/wiki/${visualPage.path}/history`);
  expect(await screen.findByRole('region', { name: 'Versions' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  finish();
  expect(await screen.findByText('No versions yet.')).toBeVisible();
});

it('renders the approved loading, query-error and empty states', async () => {
  let finishLoading = () => {};
  const loading = new Promise<void>((resolve) => {
    finishLoading = resolve;
  });
  server.use(
    http.get('*/api/v1/wiki/pages/:path', async () => {
      await loading;
      return problem('STORAGE_ERROR', 500);
    }),
  );
  open('/wiki/sample.md');
  expect(await screen.findByRole('region', { name: 'Wiki page' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  finishLoading();
  expect(await screen.findByRole('alert')).toHaveTextContent('The wiki storage is unavailable.');
  server.use(
    http.get('*/api/v1/wiki/pages/:path', () =>
      HttpResponse.json({ ...visualPage, markdown: '', sections: [] }),
    ),
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('This page is empty.')).toBeVisible();
});

it('redirects on a protected page 401 and returns to its URL after sign-in', async () => {
  let signedIn = false;
  server.use(
    http.get('*/api/v1/auth/session', () =>
      HttpResponse.json(signedIn ? visualSession : { user: null, csrfToken: null }),
    ),
    http.get('*/api/v1/wiki/pages/:path', () =>
      signedIn ? HttpResponse.json(visualPage) : problem('UNAUTHENTICATED', 401),
    ),
    http.post('*/api/v1/auth/login', async ({ request }) => {
      expect(await request.json()).toEqual({ email: 'mn@example.test', password: 'sample' });
      signedIn = true;
      return HttpResponse.json(visualSession);
    }),
  );
  const target = '/wiki/confocal-microscopy.md?section=principle#principle';
  const router = open(target);
  const submit = await screen.findByRole('button', { name: 'Sign in' });
  expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(router.history.location.href).toBe(`/login?${new URLSearchParams({ next: target })}`);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'mn@example.test');
  await user.type(screen.getByLabelText('Password'), 'sample');
  await user.click(submit);
  expect(await screen.findByRole('region', { name: 'Principle' })).toBeVisible();
  expect(router.history.location.href).toBe(target);
});

it.each([
  ['INVALID_CREDENTIALS', 401, 'The email or password is incorrect.'],
  ['ACCOUNT_DISABLED', 403, 'This account is disabled.'],
  ['VALIDATION_FAILED', 400, 'Check your input and try again.'],
  ['RATE_LIMITED', 429, 'Try again in 30 seconds.'],
])('keeps credentials only in the login form on %s', async (code, status, message) => {
  server.use(
    http.post('*/api/v1/auth/login', () => problem(code, status, { 'Retry-After': '30' })),
  );
  const path = '/login?next=%2Fsearch%3Fq%3Dobjective';
  const router = open(path);
  const user = userEvent.setup();
  const email = await screen.findByLabelText('Email');
  const password = screen.getByLabelText('Password');
  await user.type(email, 'reader@example.test');
  await user.type(password, 'sample');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(email).toHaveValue('reader@example.test');
  expect(password).toHaveValue('sample');
  expect(router.history.location.href).toBe(path);
  expect(JSON.stringify(sessionStorage)).not.toContain('sample');
});
