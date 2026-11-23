import { useQuery } from '@tanstack/react-query';
import { apiData, useApi } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';

export function useHomeQueries() {
  const api = useApi();
  return {
    tree: useQuery({
      queryKey: queryKeys.tree,
      queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/wiki/tree', { signal })),
    }),
    recent: useQuery({
      queryKey: queryKeys.recent,
      queryFn: async ({ signal }) =>
        apiData(
          await api.GET('/api/v1/wiki/recent', { params: { query: queryKeys.recent[1] }, signal }),
        ),
    }),
  };
}
