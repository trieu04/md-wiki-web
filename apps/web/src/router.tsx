import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import {
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  defaultParseSearch,
  defaultStringifySearch,
  Outlet,
  useLocation,
  useRouter,
} from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { HomeScreen } from './features/home/HomeScreen';
import { LoginScreen } from './features/login/LoginScreen';
import { pageQueryOptions } from './features/markdown/page-query';
import { PageScreen } from './features/page/PageScreen';
import { userInitials } from './features/navigation/model';
import { SearchScreen } from './features/search/SearchScreen';
import { ApiContext, createWebData, safeNext, useWikiMeta } from './lib/api';
import { useSession } from './lib/session';
import { ReadingLayout } from './ui/ReadingLayout';
import type { TopBarActive } from './ui/TopBar';
import { WorkspaceLayout } from './ui/WorkspaceLayout';
import type { WorkNavActive } from './ui/WorkNav';

const root = createRootRouteWithContext<ReturnType<typeof createWebData>>()({
  notFoundComponent: () => null,
  component: function Root() {
    const { api, queryClient } = root.useRouteContext();
    return (
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={api}>
          <Outlet />
        </ApiContext.Provider>
      </QueryClientProvider>
    );
  },
});

function useTopBar(active: TopBarActive, query = '') {
  const meta = useWikiMeta();
  const { data } = useSession();
  return {
    active,
    query,
    wikiName: meta.data?.wikiName ?? 'Wiki',
    ...(import.meta.env.MODE === 'visual' && { browseHref: '/wiki/confocal-microscopy.md' }),
    initials: userInitials(data?.user?.name),
    role: data?.user?.roles.some(
      (role) => role === 'owner' || role === 'reviewer' || role === 'publisher',
    )
      ? ('page author' as const)
      : ('reader' as const),
  };
}

function readingScreen(active: TopBarActive) {
  return function ReadingScreen() {
    return <ReadingLayout topBar={useTopBar(active)} />;
  };
}
function workspaceScreen(active: WorkNavActive) {
  return function WorkspaceScreen() {
    return <WorkspaceLayout topBar={useTopBar('workspace')} workNav={{ active }} />;
  };
}

const home = createRoute({
  getParentRoute: () => root,
  path: '/',
  component: function Home() {
    const recent = useLocation({ select: ({ hash }) => hash === 'recent' });
    return <HomeScreen topBar={useTopBar(recent ? 'recent' : 'home')} />;
  },
});
const search = createRoute({
  getParentRoute: () => root,
  path: '/search',
  validateSearch: ({ q }) => ({ q: typeof q === 'string' ? q : '' }),
  component: function Search() {
    const { q } = search.useSearch();
    return <SearchScreen key={q.trim()} q={q} topBar={useTopBar('search', q)} />;
  },
});
// The Trust drawer is an overlay on this route, not a separate URL (F-04).
const page = createRoute({
  getParentRoute: () => root,
  path: '/wiki/$',
  loader: ({ context, params }) => {
    if (params._splat) {
      // The component observes this query and renders its loading and error states.
      void context.queryClient
        .query(pageQueryOptions(context.api, params._splat))
        .catch(() => undefined);
    }
  },
  component: function WikiPage() {
    const { _splat } = page.useParams();
    const anchor = useLocation({ select: ({ hash }) => hash });
    return <PageScreen path={_splat ?? ''} anchor={anchor} topBar={useTopBar('browse')} />;
  },
});
const history = createRoute({
  getParentRoute: () => root,
  path: '/wiki/{$}/history',
  component: function WikiHistory() {
    const { _splat } = history.useParams();
    return <PageScreen path={_splat ?? ''} history topBar={useTopBar('browse')} />;
  },
});
const login = createRoute({
  getParentRoute: () => root,
  path: '/login',
  validateSearch: ({ next }) => ({ next: typeof next === 'string' ? safeNext(next) : undefined }),
  component: function Login() {
    const { next } = login.useSearch();
    const router = useRouter();
    return (
      <LoginScreen onSignedIn={() => void router.navigate({ href: next ?? '/', replace: true })} />
    );
  },
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
  history,
  login,
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

export function createAppRouter(history: RouterHistory = createBrowserHistory()) {
  const context = createWebData({
    currentHref: () => history.location.href,
    redirectToLogin(next) {
      history.replace(`/login?${new URLSearchParams({ next })}`);
    },
  });
  return createRouter({
    routeTree,
    context,
    history,
    parseSearch(raw) {
      const search = defaultParseSearch(raw) as Record<string, unknown>;
      const params = new URLSearchParams(raw);
      // TanStack's JSON parsing otherwise coerces inputs such as ?q=123 or ?q=null.
      for (const key of ['q', 'section', 'next']) {
        const value = params.get(key);
        if (value !== null) search[key] = value;
      }
      return search;
    },
    stringifySearch({ q, section, next, ...rest }) {
      const params = new URLSearchParams(defaultStringifySearch(rest));
      if (typeof q === 'string') params.set('q', q);
      if (typeof section === 'string') params.set('section', section);
      if (typeof next === 'string') params.set('next', next);
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
