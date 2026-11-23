import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';
import { homeDescription, visualRecent, visualSearch, visualTree } from './home-search';
import { visualDraft, visualSuggestions } from './contribute';
import {
  visualProposalDiscussion,
  visualTopic,
  visualTopicList,
  visualTopics,
} from './discussions';
import {
  visualJobs,
  visualModels,
  visualProposalQuality,
  visualRules,
  visualSelfCheck,
} from './quality';
import {
  visualArtifact,
  visualAudit,
  visualBlocked,
  visualDiff,
  visualProposal,
  visualProposalList,
} from './review';
import { frameSamples } from './samples';
import { visualHistory, visualMeta, visualPage, visualPageTopic } from './reading';
import { adminPage, visualOwnerSession, visualTeams, visualTokens, visualUsers } from './settings';

const notFound = () =>
  HttpResponse.json(
    { code: 'NOT_FOUND' },
    { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
  );

const draft = () => visualDraft(new URLSearchParams(globalThis.location.search).has('baseChanged'));

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
  http.get('/api/v1/auth/session', () => HttpResponse.json(visualOwnerSession)),
  http.get('/api/v1/admin/users', () => HttpResponse.json(adminPage(visualUsers))),
  http.get('/api/v1/admin/teams', () => HttpResponse.json(adminPage(visualTeams))),
  http.get('/api/v1/admin/tokens', () => HttpResponse.json(adminPage(visualTokens))),
  http.get('/api/v1/wiki/pages/:path', ({ params }) =>
    params.path === visualPage.path ? HttpResponse.json(visualPage) : notFound(),
  ),
  http.get('/api/v1/wiki/pages/:path/history', ({ params }) =>
    params.path === visualPage.path ? HttpResponse.json(visualHistory) : notFound(),
  ),
  // F-06 Editor and F-05 Your suggestions. Writes echo the draft; nothing is persisted.
  http.post('/api/v1/drafts', () => HttpResponse.json(draft(), { status: 200 })),
  http.get('/api/v1/drafts/:id', () => HttpResponse.json(draft())),
  http.patch('/api/v1/drafts/:id', async ({ request }) =>
    HttpResponse.json({
      ...draft(),
      ...((await request.json()) as object),
      updatedAt: new Date().toISOString(),
    }),
  ),
  http.post('/api/v1/drafts/:id/rebase', () => HttpResponse.json(visualDraft(false))),
  http.post('/api/v1/drafts/:id/sources', () => HttpResponse.json(draft())),
  http.delete('/api/v1/drafts/:id/sources/:path', () => HttpResponse.json(draft())),
  http.delete('/api/v1/drafts/:id', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/v1/me/suggestions', () => HttpResponse.json(visualSuggestions)),
  // F-09/F-10/F-07/F-13 (P5-C/D). `?scenario=` on the page URL picks an F-10 scenario.
  http.get('/api/v1/proposals', ({ request }) =>
    HttpResponse.json(visualProposalList(new URL(request.url).searchParams.get('tab'))),
  ),
  http.get('/api/v1/proposals/:slug', ({ params }) =>
    HttpResponse.json(
      visualProposal(
        String(params.slug),
        new URLSearchParams(globalThis.location.search).get('scenario'),
      ),
    ),
  ),
  http.get('/api/v1/proposals/:slug/diff', () => HttpResponse.json(visualDiff())),
  // F-11 Discussions and F-10 › Discussion (P6-04…06). Writes echo the stored topic.
  http.get('/api/v1/proposals/:slug/discussion', ({ params }) =>
    HttpResponse.json(
      visualProposalDiscussion(
        String(params.slug),
        new URLSearchParams(globalThis.location.search).get('scenario'),
      ),
    ),
  ),
  http.get('/api/v1/topics', ({ request }) =>
    HttpResponse.json(visualTopicList(new URL(request.url).searchParams.get('filter'))),
  ),
  http.get('/api/v1/topics/:id', ({ params }) => {
    const topic = visualTopic(String(params.id));
    return topic ? HttpResponse.json(topic) : notFound();
  }),
  http.post('/api/v1/topics', () => HttpResponse.json(visualTopics[1], { status: 201 })),
  http.post('/api/v1/topics/:id/:action', ({ params }) => {
    const topic = visualTopic(String(params.id));
    return topic ? HttpResponse.json(topic) : notFound();
  }),
  // Phase 7 quality check (P7-05/06). `?scenario=quality-running|quality-failed` on F-10.
  http.get('/api/v1/proposals/:slug/findings', () =>
    HttpResponse.json(
      visualProposalQuality(
        visualArtifact,
        new URLSearchParams(globalThis.location.search).get('scenario'),
      ),
    ),
  ),
  http.post('/api/v1/proposals/:slug/quality-check', () =>
    HttpResponse.json(visualProposalQuality(visualArtifact, 'quality-running').latest, {
      status: 202,
    }),
  ),
  http.get('/api/v1/drafts/:id/self-check', () => HttpResponse.json(visualSelfCheck())),
  http.post('/api/v1/drafts/:id/self-check', () =>
    HttpResponse.json(visualSelfCheck().latest, { status: 202 }),
  ),
  http.get('/api/v1/admin/models', () => HttpResponse.json(visualModels)),
  http.get('/api/v1/admin/rules', () => HttpResponse.json(visualRules)),
  http.get('/api/v1/ops/jobs', ({ request }) =>
    HttpResponse.json(visualJobs(new URL(request.url).searchParams)),
  ),
  http.get('/api/v1/ops/blocked', () => HttpResponse.json(visualBlocked)),
  http.get('/api/v1/audit', () => HttpResponse.json(visualAudit)),
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
