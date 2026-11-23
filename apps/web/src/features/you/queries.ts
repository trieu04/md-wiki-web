import { infiniteQueryOptions, type InfiniteData } from '@tanstack/react-query';
import { apiData, type ApiClient } from '../../lib/api';
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
