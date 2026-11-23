import { queryOptions } from '@tanstack/react-query';
import { apiData, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';

export function pageQueryOptions(api: ApiClient, path: string) {
  return queryOptions({
    queryKey: queryKeys.page(path),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/wiki/pages/{path}', {
          params: { path: { path } },
          signal,
        }),
      ),
  });
}
