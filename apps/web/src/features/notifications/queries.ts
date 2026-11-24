import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { apiData, useApi, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import type { NotificationListDto } from './model';

/** Unread count for the bell; polled because notifications have no SSE event. */
export function unreadQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: [...queryKeys.notifications, 'unread'],
    refetchInterval: 60_000,
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/notifications', {
          params: { query: { unread: 'true', limit: 1 } },
          signal,
        }),
      ).unread,
  });
}

export function notificationsQueryOptions(api: ApiClient) {
  return infiniteQueryOptions<
    NotificationListDto,
    Error,
    InfiniteData<NotificationListDto>,
    readonly unknown[],
    string | null
  >({
    queryKey: [...queryKeys.notifications, 'list'],
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/notifications', {
          params: { query: pageParam == null ? {} : { cursor: pageParam } },
          signal,
        }),
      ),
  });
}

export function useMarkRead() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { ids?: string[]; all?: true }) =>
      apiData(await api.POST('/api/v1/notifications/read', { body })),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}
