import type { components } from '@md-wiki/contracts';
import { infiniteQueryOptions, queryOptions, type InfiniteData } from '@tanstack/react-query';

type HistoryDto = components['schemas']['HistoryDto'];
import { apiData, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';

export function topicQueryOptions(api: ApiClient, topic: string) {
  return queryOptions({
    queryKey: queryKeys.topic(topic),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/wiki/tree', {
          params: { query: { topic } },
          signal,
        }),
      ),
  });
}

export function historyQueryOptions(api: ApiClient, path: string) {
  return infiniteQueryOptions<
    HistoryDto,
    Error,
    InfiniteData<HistoryDto>,
    ReturnType<typeof queryKeys.history>,
    string | null
  >({
    queryKey: queryKeys.history(path),
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/wiki/pages/{path}/history', {
          params: { path: { path }, query: pageParam == null ? {} : { cursor: pageParam } },
          signal,
        }),
      ),
  });
}
