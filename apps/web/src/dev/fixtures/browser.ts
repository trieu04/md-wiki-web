import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';
import { homeDescription, visualRecent, visualSearch, visualTree } from './home-search';
import { frameSamples } from './samples';
import { visualHistory, visualMeta, visualPage, visualPageTopic, visualSession } from './reading';

const notFound = () =>
  HttpResponse.json(
    { code: 'NOT_FOUND' },
    { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
  );

// Private visual-mode transport. Add typed /api/v1 handlers here as the
// corresponding screens and API bindings are implemented.
const worker = setupWorker(
  http.get('/api/v1/meta', () =>
    HttpResponse.json({
      ...visualMeta,
      wikiName: 'Bioimaging core wiki',
      wikiDescription: homeDescription,
    }),
  ),
  http.get('/api/v1/wiki/tree', ({ request }) => {
    // Page (F-03) asks for its own topic; Home (F-01) asks for the whole tree.
    const topic = new URL(request.url).searchParams.get('topic');
    if (topic === visualPageTopic.id) return HttpResponse.json({ topics: [visualPageTopic] });
    return HttpResponse.json(
      topic ? { topics: visualTree.topics.filter(({ id }) => id === topic) } : visualTree,
    );
  }),
  http.get('/api/v1/wiki/recent', () => HttpResponse.json(visualRecent)),
  http.get('/api/v1/search', ({ request }) =>
    HttpResponse.json(visualSearch(new URL(request.url).searchParams)),
  ),
  http.get('/api/v1/auth/session', () => HttpResponse.json(visualSession)),
  http.get('/api/v1/wiki/pages/:path', ({ params }) =>
    params.path === visualPage.path ? HttpResponse.json(visualPage) : notFound(),
  ),
  http.get('/api/v1/wiki/pages/:path/history', ({ params }) =>
    params.path === visualPage.path ? HttpResponse.json(visualHistory) : notFound(),
  ),
  http.get('/__visual/fixtures/:frame', ({ params }) => {
    const { frame } = params;
    if (typeof frame !== 'string' || !Object.hasOwn(frameSamples, frame)) {
      return HttpResponse.json({ error: 'Unknown design frame' }, { status: 404 });
    }
    return HttpResponse.json(frameSamples[frame as keyof typeof frameSamples]);
  }),
);

export async function startVisualFixtures() {
  await worker.start({
    quiet: true,
    onUnhandledRequest(request, print) {
      const { pathname } = new URL(request.url);
      if (/^\/(?:api\/v1|__visual\/fixtures)(?:\/|$)/.test(pathname)) print.error();
    },
  });
  document.documentElement.dataset.mwFixturesReady = 'true';
}
