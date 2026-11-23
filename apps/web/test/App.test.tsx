import '@testing-library/jest-dom/vitest';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { visualDraft, visualSuggestions } from '../src/dev/fixtures/contribute';
import { visualRecent, visualSearch, visualTree } from '../src/dev/fixtures/home-search';
import { visualProposal, visualProposalList } from '../src/dev/fixtures/review';
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
  http.get('*/api/v1/wiki/tree', ({ request }) => {
    const topic = new URL(request.url).searchParams.get('topic');
    if (topic === visualPageTopic.id) return HttpResponse.json({ topics: [visualPageTopic] });
    return HttpResponse.json(
      topic ? { topics: visualTree.topics.filter(({ id }) => id === topic) } : visualTree,
    );
  }),
  http.get('*/api/v1/wiki/recent', () => HttpResponse.json(visualRecent)),
  http.post('*/api/v1/drafts', () => HttpResponse.json(visualDraft(false))),
  http.get('*/api/v1/drafts/:id', () => HttpResponse.json(visualDraft(false))),
  http.get('*/api/v1/me/suggestions', () => HttpResponse.json(visualSuggestions)),
  http.get('*/api/v1/search', ({ request }) =>
    HttpResponse.json(visualSearch(new URL(request.url).searchParams)),
  ),
  http.get('*/api/v1/proposals', ({ request }) =>
    HttpResponse.json(visualProposalList(new URL(request.url).searchParams.get('tab'))),
  ),
  http.get('*/api/v1/proposals/:slug', ({ params }) =>
    HttpResponse.json(visualProposal(String(params.slug), null)),
  ),
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

it('renders the conflict screen without the workspace for the resolve route', async () => {
  const router = open('/me/suggestions/detector-table/resolve');
  expect(
    await screen.findByRole('heading', { level: 1, name: 'The page changed under your proposal' }),
  ).toBeVisible();
  expect(router.state.matches.at(-1)?.routeId).toBe('/me/suggestions/$id/resolve');
  expect(screen.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument();
  await screen.findByText('A runtime wiki');
  const banner = screen.getByRole('banner');
  expect(within(banner).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
});

it.each([
  ['/', 'Home'],
  ['/#recent', 'Recent changes'],
])('renders Home and its active link at %s', async (path, active) => {
  const router = open(path);
  expect(await screen.findByRole('heading', { name: 'A runtime wiki' })).toBeVisible();
  expect(router.state.matches.at(-1)?.routeId).toBe('/');
  expect(screen.getByRole('link', { name: active, current: 'page' })).toBeVisible();
  const search = screen.getByRole('search', { name: 'Search from home' });
  expect(search).toHaveAttribute('action', '/search');
  expect(
    await within(screen.getByRole('table')).findByRole('link', { name: 'Confocal microscopy' }),
  ).toHaveAttribute('href', '/wiki/confocal-microscopy.md');
  expect(screen.getByRole('img', { name: /^41% checked against source/u })).toBeVisible();
  // D-102: the section subline and *What changed* come from the version's publication.
  const row = within(screen.getByRole('table')).getByRole('row', { name: /Confocal microscopy/u });
  expect(row).toHaveTextContent('Detectors');
  expect(row).toHaveTextContent('Hybrid detectors named HyD; link to Detectors page');
  expect(screen.getByRole('columnheader', { name: 'What changed' })).toBeVisible();
  expect(screen.queryByText('On pages you use')).not.toBeInTheDocument();
});

it('sends search controls through the generated binding, keeps recheck, and links to the section', async () => {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get('*/api/v1/search', ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      return HttpResponse.json(visualSearch(params));
    }),
  );
  open('/search?q=pinhole+size');
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'Results for “pinhole size”' })).toBeVisible();
  const results = screen.getByRole('region', { name: 'Results' });
  const principle = await within(results).findByRole('link', {
    name: 'Confocal microscopy › Principle',
  });
  expect(principle).toHaveAttribute('href', '/wiki/confocal-microscopy.md#principle');
  expect(results.querySelector('mark')).toHaveTextContent('pinhole');
  expect(
    within(results).queryByRole('link', { name: /Why this label|Ask a question/u }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Most checked first' }));
  expect((await within(results).findAllByRole('article'))[0]).toHaveTextContent(
    'Pinhole alignment',
  );
  expect(requests.at(-1)?.get('sort')).toBe('trust');
  for (const label of [
    /^Checked against source/u,
    /^Reviewed/u,
    /^Not reviewed/u,
    /^Confirmed error/u,
  ]) {
    await user.click(screen.getByRole('checkbox', { name: label }));
    await within(results).findByRole('note');
  }
  expect(requests.at(-1)?.getAll('labels[]')).toEqual(['recheck']);
  expect(within(results).getAllByRole('article')).toHaveLength(1);
  expect(within(results).getByRole('note')).toHaveTextContent('Under re-check since 22 Nov');
  await user.click(screen.getByRole('checkbox', { name: /^Microscopy techniques/u }));
  await within(results).findByRole('note');
  expect(requests.at(-1)?.getAll('topics[]')).toEqual(['microscopy-techniques']);
  await user.click(screen.getByRole('radio', { name: 'Last 30 days' }));
  await within(results).findByRole('note');
  expect(requests.at(-1)?.get('updated')).toBe('30d');
});

it('renders Home for a signed-in reader with session initials and no Workspace link', async () => {
  server.use(
    http.get('*/api/v1/auth/session', () =>
      HttpResponse.json({
        ...visualSession,
        user: { ...visualSession.user, name: 'Ana Pérez', roles: ['reader'] },
      }),
    ),
  );
  open('/');
  const banner = await screen.findByRole('banner');
  expect(await within(banner).findByRole('link', { name: /^AP — You/u })).toBeVisible();
  expect(within(banner).queryByRole('link', { name: /Workspace/u })).not.toBeInTheDocument();
});

it.each([
  ['/work', '/work', 'Inbox'],
  ['/work/discussions', '/work/discussions', 'Discussions'],
  ['/work/credibility', '/work/credibility', 'Credibility'],
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

it.each([
  ['/', 'Recently updated', 'No recent changes yet.'],
  ['/search?q=objective', 'Results', 'Didn’t find what you need?'],
])('renders loading, retry and empty states at %s', async (path, region, empty) => {
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  if (path === '/') {
    server.use(
      http.get(
        '*/api/v1/wiki/recent',
        async () => {
          await pending;
          return problem('STORAGE_ERROR', 500);
        },
        { once: true },
      ),
      http.get('*/api/v1/wiki/recent', () => HttpResponse.json({ items: [], nextCursor: null })),
    );
  } else {
    server.use(
      http.get(
        '*/api/v1/search',
        async () => {
          await pending;
          return problem('STORAGE_ERROR', 500);
        },
        { once: true },
      ),
    );
  }
  open(path);
  const list = await screen.findByRole('region', { name: region, busy: true });
  finish();
  expect(await within(list).findByRole('alert')).toHaveTextContent(
    'The wiki storage is unavailable.',
  );
  await userEvent.click(within(list).getByRole('button', { name: 'Try again' }));
  expect(await within(list).findByText(empty, { exact: false })).toBeVisible();
});

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
  // Phase 4: roles ≥ contributor get *Suggest an edit* for the selected section.
  expect(within(article).getByRole('link', { name: 'Suggest an edit' })).toHaveAttribute(
    'href',
    `/wiki/${visualPage.path}/edit?section=overview`,
  );
  expect(
    within(article).queryByText(
      /^(Follow|Ask a question|Sources|Changed outside review|Did this page help with your work\?|This section:)$/u,
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
