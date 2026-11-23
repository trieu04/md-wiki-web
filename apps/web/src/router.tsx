import { lazy, Suspense } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  defaultParseSearch,
  defaultStringifySearch,
  useLocation,
} from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { ReadingLayout } from './ui/ReadingLayout';
import type { TopBarActive } from './ui/TopBar';
import { WorkspaceLayout } from './ui/WorkspaceLayout';
import type { WorkNavActive } from './ui/WorkNav';

const wikiName = (import.meta.env.WIKI_NAME as string | undefined) || 'Bioimaging core';
const root = createRootRoute({ notFoundComponent: () => null });

function readingScreen(active: TopBarActive) {
  return () => <ReadingLayout topBar={{ active, wikiName }} />;
}
function workspaceScreen(active: WorkNavActive) {
  return () => <WorkspaceLayout topBar={{ wikiName }} workNav={{ active }} />;
}

const home = createRoute({
  getParentRoute: () => root,
  path: '/',
  component: function Home() {
    const recent = useLocation({ select: ({ hash }) => hash === 'recent' });
    return (
      <ReadingLayout topBar={{ active: recent ? 'recent' : 'home', wikiName }}>
        <div id="recent" />
      </ReadingLayout>
    );
  },
});
const search = createRoute({
  getParentRoute: () => root,
  path: '/search',
  validateSearch: ({ q }) => ({ q: typeof q === 'string' ? q : '' }),
  component: function Search() {
    const { q } = search.useSearch();
    return <ReadingLayout topBar={{ active: 'search', wikiName, query: q }} />;
  },
});
// The Trust drawer is an overlay on this route, not a separate URL (F-04).
const page = createRoute({
  getParentRoute: () => root,
  path: '/wiki/$',
  component: readingScreen('browse'),
});
const editor = createRoute({
  getParentRoute: () => root,
  path: '/wiki/{$}/edit',
  validateSearch: ({ section }) => ({ section: typeof section === 'string' ? section : undefined }),
  component: readingScreen('none'),
});
const you = createRoute({
  getParentRoute: () => root,
  path: '/me',
  component: readingScreen('you'),
});
const conflict = createRoute({
  getParentRoute: () => root,
  path: '/me/suggestions/$id/resolve',
  component: readingScreen('none'),
});
const inbox = createRoute({
  getParentRoute: () => root,
  path: '/work',
  component: workspaceScreen('inbox'),
});
const proposals = createRoute({
  getParentRoute: () => root,
  path: '/work/proposals',
  component: workspaceScreen('proposals'),
});
const review = createRoute({
  getParentRoute: () => root,
  path: '/work/proposals/$slug',
  component: workspaceScreen('proposals'),
});
const discussions = createRoute({
  getParentRoute: () => root,
  path: '/work/discussions',
  component: workspaceScreen('discussions'),
});
const credibility = createRoute({
  getParentRoute: () => root,
  path: '/work/credibility',
  component: workspaceScreen('recheck'),
});
const ops = createRoute({
  getParentRoute: () => root,
  path: '/work/ops',
  component: workspaceScreen('ops'),
});
const settings = createRoute({
  getParentRoute: () => root,
  path: '/work/settings',
  component: workspaceScreen('settings'),
});

const devRoutes = [];
if (import.meta.env.DEV) {
  const Ping = lazy(() => import('./features/dev-ping/PingRoute'));
  devRoutes.push(
    createRoute({
      getParentRoute: () => root,
      path: '/__dev/ping',
      component: () => (
        <Suspense>
          <Ping />
        </Suspense>
      ),
    }),
  );
}
// The dedicated visual build is local tooling, not a deployed product build.
if (import.meta.env.DEV || import.meta.env.MODE === 'visual') {
  const Gallery = lazy(() => import('./ui/Gallery'));
  devRoutes.push(
    createRoute({
      getParentRoute: () => root,
      path: '/__gallery',
      component: () => (
        <Suspense>
          <Gallery />
        </Suspense>
      ),
    }),
  );
}
const routeTree = root.addChildren([
  home,
  search,
  page,
  editor,
  you,
  conflict,
  inbox,
  proposals,
  review,
  discussions,
  credibility,
  ops,
  settings,
  ...devRoutes,
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history ? { history } : {}),
    parseSearch(raw) {
      const search = defaultParseSearch(raw) as Record<string, unknown>;
      const params = new URLSearchParams(raw);
      // TanStack's JSON parsing otherwise coerces inputs such as ?q=123 or ?q=null.
      for (const key of ['q', 'section']) {
        const value = params.get(key);
        if (value !== null) search[key] = value;
      }
      return search;
    },
    stringifySearch({ q, section, ...rest }) {
      const params = new URLSearchParams(defaultStringifySearch(rest));
      if (typeof q === 'string') params.set('q', q);
      if (typeof section === 'string') params.set('section', section);
      const encoded = params.toString();
      return encoded ? `?${encoded}` : '';
    },
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
