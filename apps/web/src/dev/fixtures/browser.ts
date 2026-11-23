import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';
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
  http.get('/api/v1/meta', () => HttpResponse.json(visualMeta)),
  http.get('/api/v1/auth/session', () => HttpResponse.json(visualSession)),
  http.get('/api/v1/wiki/tree', ({ request }) => {
    const topic = new URL(request.url).searchParams.get('topic');
    return HttpResponse.json({
      topics: !topic || topic === visualPageTopic.id ? [visualPageTopic] : [],
    });
  }),
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
