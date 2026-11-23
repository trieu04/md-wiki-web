// @vitest-environment node
import { ERROR_STATUS } from '@md-wiki/domain';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ApiError, createWebData, safeNext } from '../src/lib/api';
import { errorCopy } from '../src/lib/error-copy';
import { queryKeys } from '../src/lib/query-keys';
import { sessionQueryOptions } from '../src/lib/session';
import { visualSession } from '../src/dev/fixtures/reading';

const baseUrl = 'http://api.test';
const target = '/wiki/microscopy/basics.md?section=objective#objective';
const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function setup(href = target) {
  const redirectToLogin = vi.fn();
  return {
    redirectToLogin,
    ...createWebData({ baseUrl, currentHref: () => href, redirectToLogin }),
  };
}

it('reads CSRF from the session query and adds it only to mutations', async () => {
  const { api, queryClient } = setup();
  server.use(
    http.get(`${baseUrl}/api/v1/auth/session`, ({ request }) => {
      expect(request.credentials).toBe('include');
      expect(request.headers.has('X-CSRF-Token')).toBe(false);
      return HttpResponse.json(visualSession);
    }),
    http.get(`${baseUrl}/api/v1/meta`, ({ request }) => {
      expect(request.headers.has('X-CSRF-Token')).toBe(false);
      return HttpResponse.json({ wikiName: 'Wiki', wikiDescription: '' });
    }),
    http.post(`${baseUrl}/api/v1/auth/logout`, ({ request }) => {
      expect(request.credentials).toBe('include');
      expect(request.headers.get('X-CSRF-Token')).toBe(visualSession.csrfToken);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await expect(queryClient.query(sessionQueryOptions(api))).resolves.toEqual(visualSession);
  expect((await api.GET('/api/v1/meta')).response.status).toBe(200);
  expect((await api.POST('/api/v1/auth/logout')).response.status).toBe(204);
});

it('clears cached private data and computes the full return target on 401', async () => {
  const { api, queryClient, redirectToLogin } = setup();
  queryClient.setQueryData(queryKeys.session, visualSession);
  queryClient.setQueryData(queryKeys.page('private.md'), { private: true });
  server.use(
    http.get(`${baseUrl}/api/v1/wiki/tree`, () => new HttpResponse(null, { status: 401 })),
  );
  await expect(api.GET('/api/v1/wiki/tree')).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
    status: 401,
  });
  expect(queryClient.getQueryData(queryKeys.session)).toEqual({ user: null, csrfToken: null });
  expect(queryClient.getQueryData(queryKeys.page('private.md'))).toBeUndefined();
  expect(redirectToLogin).toHaveBeenCalledExactlyOnceWith(target);
});

it('decodes problem+json into an ApiError, preserving Retry-After and request ID', async () => {
  const { api, redirectToLogin } = setup('/login?next=%2F');
  server.use(
    http.post(`${baseUrl}/api/v1/auth/login`, () =>
      HttpResponse.json(
        {
          code: 'RATE_LIMITED',
          requestId: 'example-id',
        },
        {
          status: 429,
          headers: {
            'Content-Type': 'application/problem+json; charset=utf-8',
            'Retry-After': '15',
          },
        },
      ),
    ),
  );
  const result = api.POST('/api/v1/auth/login', {
    body: { email: 'reader@example.test', password: 'sample' },
  });
  await expect(result).rejects.toBeInstanceOf(ApiError);
  await expect(result).rejects.toMatchObject({
    code: 'RATE_LIMITED',
    retryAfter: '15',
    requestId: 'example-id',
    status: 429,
  });
  expect(redirectToLogin).not.toHaveBeenCalled();
});

it('has nonempty user copy for every domain error code', () => {
  expect(Object.keys(errorCopy).sort()).toEqual(Object.keys(ERROR_STATUS).sort());
  expect(Object.values(errorCopy).every((copy) => copy.trim().length > 0)).toBe(true);
});

it.each([
  'https://example.test',
  '//example.test',
  '/\\example.test',
  '/%2Fexample.test',
  '/%5Cexample.test',
  '/.//example.test',
  '/login?next=%2F',
  '/%6Cogin',
  '/bad%FF',
])('rejects an unsafe return path: %s', (next) => {
  expect(safeNext(next)).toBe('/');
});

it('preserves an internal pathname, search and hash', () => {
  expect(safeNext(target)).toBe(target);
});
