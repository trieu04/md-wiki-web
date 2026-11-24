import { useQuery } from '@tanstack/react-query';
import { apiData, useApi } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import type { HomeScope } from './model';

export function useHomeQueries(scope: HomeScope = 'all', signedIn = false, ready = true) {
  const api = useApi();
  const key = scope === 'mine' ? queryKeys.recentMine : queryKeys.recent;
  return {
    tree: useQuery({
      queryKey: queryKeys.tree,
      queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/wiki/tree', { signal })),
    }),
    // Wait for the session so the scope does not flip from *All pages* to *Pages you use*.
    recent: useQuery({
      queryKey: key,
      enabled: ready,
      queryFn: async ({ signal }) =>
        apiData(await api.GET('/api/v1/wiki/recent', { params: { query: key[1] }, signal })),
    }),
    // Home › *On pages you use* (§7.7.9): signed-in people only.
    notices: useQuery({
      queryKey: queryKeys.notices,
      enabled: signedIn,
      queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/me/notices', { signal })),
    }),
  };
}
