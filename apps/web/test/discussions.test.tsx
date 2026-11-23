import '@testing-library/jest-dom/vitest';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@md-wiki/contracts';
import { visualTopic, visualTopicList, visualTopics } from '../src/dev/fixtures/discussions';
import { visualTree } from '../src/dev/fixtures/home-search';
import { visualPage, visualSession } from '../src/dev/fixtures/reading';
import { visualProposalList } from '../src/dev/fixtures/review';
import { createAppRouter } from '../src/router';

type Detail = components['schemas']['TopicDetailDto'];

function need<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture value missing');
  return value;
}

const problem = (code: string, status: number) =>
  HttpResponse.json({ code }, { status, headers: { 'Content-Type': 'application/problem+json' } });

const writes: { path: string; body: unknown }[] = [];
const filters: (string | null)[] = [];
let session: object = visualSession;
const server = setupServer(
  http.get('*/api/v1/meta', () => HttpResponse.json({ wikiName: 'Wiki', wikiDescription: '' })),
  http.get('*/api/v1/auth/session', () => HttpResponse.json(session)),
  http.get('*/api/v1/proposals', () => HttpResponse.json(visualProposalList('open'))),
  http.get('*/api/v1/topics', ({ request }) => {
    const filter = new URL(request.url).searchParams.get('filter');
    filters.push(filter);
    return HttpResponse.json(visualTopicList(filter));
  }),
  http.get('*/api/v1/topics/:id', ({ params }) => {
    const topic = visualTopic(String(params.id));
    return topic ? HttpResponse.json(topic) : problem('NOT_FOUND', 404);
  }),
  http.get('*/api/v1/wiki/tree', () => HttpResponse.json(visualTree)),
  http.get('*/api/v1/wiki/pages/:path', () => HttpResponse.json(visualPage)),
);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  writes.length = 0;
  filters.length = 0;
  session = visualSession;
  sessionStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});

function open(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<RouterProvider router={router} />);
  return router;
}

const [holding, report] = visualTopics as [Detail, Detail, Detail];

it('F-11 lists topics with filter counts, selects the first and keeps filter + topic in the URL', async () => {
  const router = open('/work/discussions');
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { level: 1, name: 'Discussions' })).toBeVisible();
  const list = screen.getByRole('region', { name: 'Topics' });
  const pills = within(within(list).getByRole('group', { name: 'Filter' }));
  expect(await pills.findByRole('button', { name: 'Open 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(pills.getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Open 3',
    'Mine 2',
    'Closed 41',
    'All',
  ]);
  const first = await within(list).findByRole('button', { name: /^Lateral FWHM/u });
  expect(first).toHaveAttribute('aria-pressed', 'true');
  expect(first).toHaveTextContent('point-spread-function.md#fwhm');
  expect(first).toHaveTextContent('Holds psf-fwhm-table');
  expect(first).toHaveTextContent(/3 replies · \d+ (min|h|d)/u);
  const thread = await screen.findByRole('region', { name: 'Thread' });
  expect(
    await within(thread).findByRole('heading', { level: 2, name: holding.title }),
  ).toBeVisible();
  expect(within(thread).getByText('m.nguyen, h.pham')).toBeVisible();
  expect(within(thread).getByText('discussion v2')).toBeVisible();
  expect(within(thread).getByRole('link', { name: 'Held proposal' })).toHaveAttribute(
    'href',
    '/work/proposals/psf-fwhm-table',
  );
  expect(within(thread).getByRole('link', { name: 'Open section' })).toHaveAttribute(
    'href',
    '/wiki/point-spread-function.md#fwhm',
  );
  const entries = within(within(thread).getByRole('list', { name: 'Entries' })).getAllByRole(
    'listitem',
  );
  expect(entries).toHaveLength(3);
  expect(entries[0]).toHaveTextContent('reviewer-agentopened the topic');
  expect(within(need(entries[0])).getByText('AI')).toBeVisible();
  // WorkNav: Discussions shows the open count (D-118).
  const nav = screen.getByRole('navigation', { name: 'Workspace' });
  await waitFor(() => {
    expect(within(nav).getByRole('link', { name: /Discussions/u })).toHaveTextContent(
      'Discussions 3',
    );
  });

  await user.click(within(list).getByRole('button', { name: /^Pinhole wording outdated/u }));
  expect(router.state.location.search).toEqual({ filter: 'open', topic: report.id });
  expect(await within(thread).findByRole('heading', { name: report.title })).toBeVisible();

  await user.click(pills.getByRole('button', { name: 'Closed 41' }));
  expect(router.state.location.search).toEqual({ filter: 'closed' });
  const closedRow = await within(list).findByRole('button', { name: /^Should STED/u });
  expect(closedRow).toHaveTextContent('Resolved');
  const closedThread = await screen.findByRole('region', { name: 'Thread' });
  expect(await within(closedThread).findByText('h.pham · Resolved')).toBeVisible();
  expect(within(closedThread).getByText('Use the 2019 review article instead.')).toBeVisible();
  // Closed: only Reopen (can.reopen), no reply or close.
  expect(within(closedThread).getByRole('button', { name: 'Reopen' })).toBeVisible();
  expect(within(closedThread).queryByRole('button', { name: 'Post reply' })).toBeNull();
  expect(within(closedThread).queryByText('Close as')).toBeNull();
  expect(filters).toContain('closed');
});

it('F-11 posts replies and closes with the reply text as rationale, sending the read version', async () => {
  server.use(
    http.post('*/api/v1/topics/:id/:action', async ({ request, params }) => {
      const body = await request.json();
      writes.push({ path: String(params.action), body });
      return HttpResponse.json({ ...report, version: report.version + 1 });
    }),
  );
  open(`/work/discussions?topic=${report.id}`);
  const user = userEvent.setup();
  const thread = await screen.findByRole('region', { name: 'Thread' });
  await within(thread).findByRole('heading', { name: report.title });
  const reply = within(thread).getByLabelText('Reply');
  expect(reply).toHaveAttribute('placeholder', 'Write a reply.');

  await user.click(within(thread).getByRole('button', { name: 'Post reply' }));
  expect(within(thread).getByText('Write a reply first.')).toBeVisible();
  await user.click(within(thread).getByRole('button', { name: 'Resolved' }));
  expect(
    within(thread).getByText('Write the rationale in the reply box before closing.'),
  ).toBeVisible();
  expect(writes).toHaveLength(0);

  await user.type(reply, 'The wording is from 2019.');
  expect(sessionStorage.getItem(`mw:form:topic:${report.id}`)).toBe('The wording is from 2019.');
  await user.click(within(thread).getByRole('button', { name: 'Post reply' }));
  await waitFor(() => {
    expect(writes).toEqual([
      {
        path: 'comments',
        body: { body: 'The wording is from 2019.', kind: 'comment', version: 1 },
      },
    ]);
  });
  await waitFor(() => {
    expect(reply).toHaveValue('');
  });
  expect(sessionStorage.getItem(`mw:form:topic:${report.id}`)).toBeNull();

  await user.type(reply, 'Fixed in 20261123-1.');
  await user.click(within(thread).getByRole('button', { name: 'Rejected' }));
  await waitFor(() => {
    expect(writes[1]).toEqual({
      path: 'close',
      body: { outcome: 'rejected', reason: 'Fixed in 20261123-1.', version: 2 },
    });
  });
});

it('F-11 locks the thread on DISCUSSION_CHANGED and keeps the reply until Reload', async () => {
  let calls = 0;
  server.use(
    http.post('*/api/v1/topics/:id/comments', () => {
      calls++;
      return problem('DISCUSSION_CHANGED', 409);
    }),
  );
  open(`/work/discussions?topic=${holding.id}`);
  const user = userEvent.setup();
  const thread = await screen.findByRole('region', { name: 'Thread' });
  const reply = await within(thread).findByLabelText('Reply');
  expect(reply).toHaveAttribute(
    'placeholder',
    'Write a reply. Posting a reply locks open review decisions until reviewers reread.',
  );
  await user.type(reply, 'Agreed.');
  await user.click(within(thread).getByRole('button', { name: 'Post reply' }));
  const lock = await within(thread).findByRole('status');
  expect(lock).toHaveTextContent(
    'New entry in this topic. Reread before posting. Your text is kept.',
  );
  expect(within(thread).getByRole('button', { name: 'Post reply' })).toBeDisabled();
  expect(reply).toHaveValue('Agreed.');
  await user.click(within(lock).getByRole('button', { name: 'Reload' }));
  await waitFor(() => {
    expect(within(thread).getByRole('button', { name: 'Post reply' })).toBeEnabled();
  });
  expect(calls).toBe(1);
});

it('F-11 shows a read-only note when the viewer may not write', async () => {
  server.use(
    http.get('*/api/v1/topics/:id', () =>
      HttpResponse.json({ ...report, can: { comment: false, close: false, reopen: false } }),
    ),
  );
  open(`/work/discussions?topic=${report.id}`);
  const thread = await screen.findByRole('region', { name: 'Thread' });
  expect(
    await within(thread).findByText('You can read this topic but not reply to it.'),
  ).toBeVisible();
  expect(within(thread).queryByRole('textbox')).toBeNull();
});

it('Ask a question: prefilled page, section and title; validates; posts and opens the topic', async () => {
  session = { ...visualSession, user: { ...visualSession.user, roles: ['reader'] } };
  server.use(
    http.post('*/api/v1/topics', async ({ request }) => {
      writes.push({ path: 'topics', body: await request.json() });
      return HttpResponse.json(report, { status: 201 });
    }),
  );
  const router = open('/ask?path=confocal-microscopy.md&section=principle&q=pinhole+size');
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { level: 1, name: 'Ask a question' })).toBeVisible();
  const page = screen.getByLabelText('Page');
  await waitFor(() => {
    expect(page).toHaveValue('confocal-microscopy.md');
  });
  const section = screen.getByLabelText('Section');
  await waitFor(() => {
    expect(within(section).getByRole('option', { name: 'Principle' })).toBeInTheDocument();
  });
  expect(section).toHaveValue('principle');
  expect(screen.getByLabelText('Title')).toHaveValue('pinhole size');

  await user.click(screen.getByRole('button', { name: 'Post question' }));
  expect(screen.getByText('Write your question.')).toBeVisible();
  expect(writes).toHaveLength(0);
  await user.type(screen.getByLabelText('Your question'), 'Which size for water objectives?');
  await user.click(screen.getByRole('button', { name: 'Post question' }));
  await waitFor(() => {
    expect(writes).toEqual([
      {
        path: 'topics',
        body: {
          path: 'confocal-microscopy.md',
          anchor: 'principle',
          title: 'pinhole size',
          body: 'Which size for water objectives?',
        },
      },
    ]);
  });
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/work/discussions');
  });
  expect(router.state.location.search).toEqual({ filter: 'mine', topic: report.id });
});

it('Ask a question without a page asks for one and keeps the question on an error', async () => {
  server.use(http.post('*/api/v1/topics', () => problem('NOT_FOUND', 404)));
  open('/ask');
  const user = userEvent.setup();
  await screen.findByRole('heading', { level: 1, name: 'Ask a question' });
  await user.type(screen.getByLabelText('Title'), 'Booking rules');
  await user.type(screen.getByLabelText('Your question'), 'Who approves overnight runs?');
  await user.click(screen.getByRole('button', { name: 'Post question' }));
  expect(screen.getByText('Choose the page your question is about.')).toBeVisible();
  expect(screen.getByLabelText('Section')).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Page'), 'confocal-microscopy.md');
  await user.click(screen.getByRole('button', { name: 'Post question' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'We could not find what you requested.',
  );
  expect(screen.getByLabelText('Your question')).toHaveValue('Who approves overnight runs?');
  expect(sessionStorage.getItem('mw:form:ask:')).toBe('Who approves overnight runs?');
});
