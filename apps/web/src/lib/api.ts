import { createApiClient } from '@md-wiki/contracts';
import type { components } from '@md-wiki/contracts';
import { ERROR_STATUS } from '@md-wiki/domain';
import type { ErrorCode } from '@md-wiki/domain';
import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { queryKeys } from './query-keys';

export type SessionDto = components['schemas']['SessionDto'];
export type ApiClient = ReturnType<typeof createApiClient>;

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly retryAfter: string | null = null,
    readonly requestId: string | null = null,
    readonly fields: readonly string[] = [],
  ) {
    super(code);
    this.name = 'ApiError';
  }

  static async fromResponse(response: Response) {
    const type = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
    let code: ErrorCode = response.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL';
    let fields: string[] = [];
    let requestId = response.headers.get('X-Request-Id');
    if (type === 'application/problem+json') {
      const problem = (await response.json().catch(() => null)) as {
        code?: unknown;
        fields?: unknown;
        requestId?: unknown;
      } | null;
      if (typeof problem?.code === 'string' && Object.hasOwn(ERROR_STATUS, problem.code)) {
        code = problem.code as ErrorCode;
      }
      if (typeof problem?.requestId === 'string') requestId ??= problem.requestId;
      if (Array.isArray(problem?.fields)) {
        fields = (problem.fields as ({ path?: unknown } | null)[])
          .map((field) => field?.path)
          .filter((path): path is string => typeof path === 'string');
      }
    }
    return new ApiError(
      code,
      response.status,
      response.headers.get('Retry-After'),
      requestId,
      fields,
    );
  }
}

const nextOrigin = 'https://wiki.invalid';

function hasUnsafeURLChars(value: string) {
  return value.includes('\\') || Array.from(value).some((char) => char.charCodeAt(0) < 32);
}

/** Accept only a root-relative app URL, not a login loop or a browser-normalized external URL. */
export function safeNext(href: unknown): string {
  if (
    typeof href !== 'string' ||
    !href.startsWith('/') ||
    href.startsWith('//') ||
    hasUnsafeURLChars(href)
  )
    return '/';
  try {
    const url = new URL(href, nextOrigin);
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== nextOrigin || /^\/login\/*$/i.test(pathname) || /^\/[\\/]/.test(pathname))
      return '/';
    if (hasUnsafeURLChars(pathname) || url.pathname.startsWith('//')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

export function createWebData({
  baseUrl = globalThis.location.origin,
  currentHref,
  redirectToLogin,
}: {
  baseUrl?: string;
  currentHref: () => string;
  redirectToLogin: (next: string) => void;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = createApiClient({
    baseUrl,
    getCsrfToken: () => queryClient.getQueryData<SessionDto>(queryKeys.session)?.csrfToken,
  });
  api.use({
    async onResponse({ response, schemaPath }) {
      if (response.ok) return;
      if (response.status === 401) {
        queryClient.clear();
        queryClient.setQueryData<SessionDto>(queryKeys.session, { user: null, csrfToken: null });
        const href = currentHref();
        // A rejected login belongs to the form. Do not erase its input or its existing destination.
        if (schemaPath !== '/api/v1/auth/login' && !/^\/login\/?(?:[?#]|$)/i.test(href)) {
          redirectToLogin(safeNext(href));
        }
      }
      throw await ApiError.fromResponse(response);
    },
  });
  return { api, queryClient };
}

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error('Missing API provider');
  return api;
}

export function apiData<T>(result: { data?: T }): T {
  if (result.data === undefined) throw new ApiError('INTERNAL', 500);
  return result.data;
}

export function metaQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.meta,
    queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/meta', { signal })),
    staleTime: Infinity,
  });
}

export function useWikiMeta() {
  return useQuery(metaQueryOptions(useApi()));
}
