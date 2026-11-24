import type { components } from '@md-wiki/contracts';
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { apiData, useApi, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import type { SuggestionsDto } from './model';

export function suggestionsQueryOptions(api: ApiClient) {
  return infiniteQueryOptions<
    SuggestionsDto,
    Error,
    InfiniteData<SuggestionsDto>,
    typeof queryKeys.suggestions,
    string | null
  >({
    queryKey: queryKeys.suggestions,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/me/suggestions', {
          params: { query: pageParam == null ? {} : { cursor: pageParam } },
          signal,
        }),
      ),
  });
}

type S = components['schemas'];
type FollowedPagesDto = S['FollowedPagesDto'];
type ActivityDto = S['ActivityDto'];

export function followedPagesQueryOptions(api: ApiClient) {
  return infiniteQueryOptions<
    FollowedPagesDto,
    Error,
    InfiniteData<FollowedPagesDto>,
    readonly unknown[],
    string | null
  >({
    queryKey: [...queryKeys.follows, 'pages'],
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/me/follows', {
          params: { query: pageParam == null ? {} : { cursor: pageParam } },
          signal,
        }),
      ),
  });
}

export function activityQueryOptions(api: ApiClient) {
  const key = queryKeys.activity('all');
  return infiniteQueryOptions<
    ActivityDto,
    Error,
    InfiniteData<ActivityDto>,
    typeof key,
    string | null
  >({
    queryKey: key,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/me/activity', {
          params: { query: { kind: 'all', ...(pageParam != null && { cursor: pageParam }) } },
          signal,
        }),
      ),
  });
}

export function summaryQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.summary,
    queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/me/summary', { signal })),
  });
}

export function prefsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.notificationPrefs,
    queryFn: async ({ signal }) =>
      apiData(await api.GET('/api/v1/me/notification-preferences', { signal })),
  });
}

export function useSavePrefs() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: S['NotificationPrefsDto']) =>
      apiData(await api.PUT('/api/v1/me/notification-preferences', { body })),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.notificationPrefs, data);
    },
  });
}
