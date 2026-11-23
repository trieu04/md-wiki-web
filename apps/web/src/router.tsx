import { QueryClientProvider, useQuery } from '@tanstack/react-query';
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
import { ConflictScreen } from './features/conflict/ConflictScreen';
import { EditorScreen } from './features/editor/EditorScreen';
import { HomeScreen } from './features/home/HomeScreen';
import { LoginScreen } from './features/login/LoginScreen';
import { pageQueryOptions } from './features/markdown/page-query';
import { AuditScreen, OpsScreen } from './features/ops/OpsScreen';
import { PageScreen } from './features/page/PageScreen';
import { proposalTab } from './features/review/model';
import { ProposalsScreen } from './features/review/ProposalsScreen';
import { proposalCountsQueryOptions } from './features/review/queries';
import { ReviewScreen } from './features/review/ReviewScreen';
import { userInitials } from './features/navigation/model';
import { SearchScreen } from './features/search/SearchScreen';
import { settingsTab } from './features/settings/model';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { hasWorkspace, workNavCounts } from './features/workspace/model';
import { YouScreen } from './features/you/YouScreen';
import { ApiContext, createWebData, safeNext, useApi, useWikiMeta } from './lib/api';
import { useServerEvents } from './lib/events';
import { useSession } from './lib/session';
import type { TopBarActive } from './ui/TopBar';
import { WorkspaceLayout } from './ui/WorkspaceLayout';
import type { WorkNavActive, WorkNavProps } from './ui/WorkNav';

const root = createRootRouteWithContext<ReturnType<typeof createWebData>>()({
  notFoundComponent: () => null,
  component: function Root() {
    const { api, queryClient } = root.useRouteContext();
    return (
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={api}>
          <ServerEvents />
          <Outlet />
        </ApiContext.Provider>
      </QueryClientProvider>
    );
  },
});

/** SSE invalidation while signed in (D-96); the visual build has no event stream. */
function ServerEvents() {
  const { data } = useSession();
  useServerEvents(!!data?.user && import.meta.env.MODE !== 'visual');
  return null;
}

function useTopBar(active: TopBarActive, query = '') {
  const meta = useWikiMeta();
  const { data } = useSession();
  return {
    active,
    query,
    wikiName: meta.data?.wikiName ?? 'Wiki',
    ...(import.meta.env.MODE === 'visual' && { browseHref: '/wiki/confocal-microscopy.md' }),
    initials: userInitials(data?.user?.name),
    role: hasWorkspace(data?.user?.roles) ? ('page author' as const) : ('reader' as const),
  };
}

/** WorkNav with counts where data exists (D-95). */
function useWorkNav(active: WorkNavActive): WorkNavProps {
  const { data } = useSession();
  const roles = data?.user?.roles;
  const counts = useQuery({
    ...proposalCountsQueryOptions(useApi()),
    enabled: hasWorkspace(roles),
  });
  const navCounts = workNavCounts(counts.data, roles);
  return { active, ...(navCounts && { counts: navCounts }) };
}

function workspaceScreen(active: WorkNavActive) {
  return function WorkspaceScreen() {
    return <WorkspaceLayout topBar={useTopBar('workspace')} workNav={useWorkNav(active)} />;
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
  component: function WikiEditor() {
    const { _splat } = editor.useParams();
    const { section } = editor.useSearch();
    const path = _splat ?? '';
    return (
      <EditorScreen
        key={`${path}#${section ?? ''}`}
        path={path}
        section={section ?? null}
        topBar={useTopBar('none')}
      />
    );
  },
});
const you = createRoute({
  getParentRoute: () => root,
  path: '/me',
  component: function You() {
    return <YouScreen topBar={useTopBar('you')} />;
  },
});
// `:id` is the proposal slug (D-99).
const conflict = createRoute({
  getParentRoute: () => root,
  path: '/me/suggestions/$id/resolve',
  component: function Conflict() {
    const { id } = conflict.useParams();
    return <ConflictScreen key={id} slug={id} topBar={useTopBar('none')} />;
  },
});
const inbox = createRoute({
  getParentRoute: () => root,
  path: '/work',
  component: workspaceScreen('inbox'),
});
const proposals = createRoute({
  getParentRoute: () => root,
  path: '/work/proposals',
  validateSearch: ({ tab }) => ({ tab: proposalTab(tab) }),
  component: function Proposals() {
    const { tab } = proposals.useSearch();
    const navigate = proposals.useNavigate();
    return (
      <ProposalsScreen
        tab={tab}
        onTab={(next) => void navigate({ search: { tab: next }, replace: true })}
        topBar={useTopBar('workspace')}
        workNav={useWorkNav('proposals')}
      />
    );
  },
});
const review = createRoute({
  getParentRoute: () => root,
  path: '/work/proposals/$slug',
  component: function Review() {
    const { slug } = review.useParams();
    return (
      <ReviewScreen
        key={slug}
        slug={slug}
        topBar={useTopBar('workspace')}
        workNav={useWorkNav('proposals')}
      />
    );
  },
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
  component: function Ops() {
    return <OpsScreen topBar={useTopBar('workspace')} workNav={useWorkNav('ops')} />;
  },
});
const audit = createRoute({
  getParentRoute: () => root,
  path: '/work/ops/audit',
  component: function Audit() {
    return <AuditScreen topBar={useTopBar('workspace')} workNav={useWorkNav('ops')} />;
  },
});
const settings = createRoute({
  getParentRoute: () => root,
  path: '/work/settings',
  validateSearch: ({ tab }) => ({ tab: settingsTab(tab) }),
  component: function Settings() {
    const { tab } = settings.useSearch();
    const navigate = settings.useNavigate();
    return (
      <SettingsScreen
        tab={tab}
        onTab={(next) => void navigate({ search: { tab: next }, replace: true })}
        topBar={useTopBar('workspace')}
        workNav={useWorkNav('settings')}
      />
    );
  },
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
  audit,
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
      for (const key of ['q', 'section', 'next', 'tab']) {
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
