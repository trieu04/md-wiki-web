import { http, HttpResponse } from 'msw';
import {
  visualActivity,
  visualCredibilityPages,
  visualCredibilitySources,
  visualFollows,
  visualGates,
  visualNotices,
  visualNotifications,
  visualPeople,
  visualPrefs,
  visualQueue,
  visualQueueItems,
  visualSummary,
  visualWhy,
} from './credibility';

const notFound = () =>
  HttpResponse.json(
    { code: 'NOT_FOUND' },
    { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
  );

/** Phase 9 (F-03 rail, F-04, F-05, F-01 notices, F-12, F-14 Trust labels). Writes echo; nothing is stored. */
export function credibilityHandlers(base: string) {
  return [
    http.get(`${base}/sections/:path/:anchor/why`, ({ params }) => {
      const why = visualWhy(String(params.anchor));
      return why ? HttpResponse.json(why) : notFound();
    }),
    http.get(`${base}/sections/:path/:anchor/people`, ({ request }) =>
      HttpResponse.json(visualPeople(new URL(request.url).searchParams.get('reveal') === 'true')),
    ),
    http.get(`${base}/me/follows`, () => HttpResponse.json(visualFollows)),
    http.post(`${base}/follows`, async ({ request }) => {
      const body = (await request.json()) as { path: string; anchor?: string | null };
      return HttpResponse.json(
        {
          path: body.path,
          anchor: body.anchor ?? null,
          reason: 'manual',
          muted: false,
          createdAt: new Date().toISOString(),
        },
        { status: 201 },
      );
    }),
    http.delete(`${base}/follows`, () => new HttpResponse(null, { status: 204 })),
    http.get(`${base}/me/activity`, () => HttpResponse.json(visualActivity)),
    http.get(`${base}/me/summary`, () => HttpResponse.json(visualSummary)),
    http.get(`${base}/me/notification-preferences`, () => HttpResponse.json(visualPrefs)),
    http.put(`${base}/me/notification-preferences`, async ({ request }) =>
      HttpResponse.json(await request.json()),
    ),
    http.get(`${base}/me/notices`, () => HttpResponse.json(visualNotices)),
    http.get(`${base}/notifications`, () => HttpResponse.json(visualNotifications)),
    http.post(`${base}/notifications/read`, () => HttpResponse.json({ unread: 0 })),
    http.post(`${base}/page-feedback`, async ({ request }) => {
      const body = (await request.json()) as { answer: string; versionLabel: string };
      return HttpResponse.json(
        {
          answer: body.answer,
          versionLabel: body.versionLabel,
          createdAt: new Date().toISOString(),
        },
        { status: 201 },
      );
    }),
    http.get(`${base}/credibility/queue`, ({ request }) =>
      HttpResponse.json(visualQueue(new URL(request.url).searchParams.get('type'))),
    ),
    http.get(`${base}/credibility/queue/:type/:id`, ({ params }) => {
      const item = visualQueueItems.find(({ id }) => id === params.id);
      return item ? HttpResponse.json(item) : notFound();
    }),
    http.post(`${base}/credibility/decisions`, async ({ request }) => {
      const body = (await request.json()) as { id: string; outcome: string; reason: string };
      const item = visualQueueItems.find(({ id }) => id === body.id);
      if (!item) return notFound();
      return HttpResponse.json({
        ...item,
        decisions: [
          {
            outcome: body.outcome,
            reason: body.reason,
            actor: { id: '00000000-0000-4000-8000-000000000000', name: 'm.nguyen', kind: 'human' },
            at: new Date().toISOString(),
          },
        ],
        can: { decide: false },
      });
    }),
    http.get(`${base}/credibility/pages`, () => HttpResponse.json(visualCredibilityPages)),
    http.get(`${base}/credibility/sources`, () => HttpResponse.json(visualCredibilitySources)),
    http.post(`${base}/credibility/jobs/:kind`, ({ params }) =>
      HttpResponse.json(
        {
          jobId: '00000000-0000-4000-8000-000000000501',
          kind: params.kind,
          status: 'queued',
          trigger: 'manual',
          createdAt: new Date().toISOString(),
        },
        { status: 202 },
      ),
    ),
    http.get(`${base}/admin/credibility-gates`, () => HttpResponse.json(visualGates)),
    http.put(`${base}/admin/credibility-gates/:capability`, async ({ params, request }) => {
      const body = (await request.json()) as {
        enabled: boolean;
        runRecord?: string;
        runDate?: string;
      };
      const gate = visualGates.items.find(({ capability }) => capability === params.capability);
      if (!gate) return notFound();
      return HttpResponse.json({
        ...gate,
        enabled: body.enabled,
        reference:
          body.runRecord && body.runDate
            ? { runRecord: body.runRecord, runDate: body.runDate }
            : gate.reference,
        updatedAt: new Date().toISOString(),
      });
    }),
  ];
}
