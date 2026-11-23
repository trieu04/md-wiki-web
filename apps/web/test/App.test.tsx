import '@testing-library/jest-dom/vitest';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAppRouter } from '../src/router';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
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
  ['/wiki/microscopy/%E6%96%87%20%E5%AD%97.md', '/wiki/$', 'Browse'],
  ['/wiki/microscopy/%E6%96%87%20%E5%AD%97.md/edit?section=overview', '/wiki/{$}/edit', null],
  ['/me', '/me', 'MN — You: followed pages and your activity'],
  ['/me/suggestions/example-id/resolve', '/me/suggestions/$id/resolve', null],
])('uses the empty reading screen for %s', async (path, id, active) => {
  const router = open(path);
  const main = await screen.findByRole('main');
  expect(main).toHaveTextContent(/^$/);
  expect(router.state.matches.at(-1)?.routeId).toBe(id);
  expect(screen.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument();
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
    within(screen.getByRole('banner')).getByRole('link', { name: 'Workspace', current: 'page' }),
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
