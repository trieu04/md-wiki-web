import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';
import { frameSamples } from './samples';

// Private visual-mode transport. Add typed /api/v1 handlers here as the
// corresponding screens and API bindings are implemented.
const worker = setupWorker(
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
