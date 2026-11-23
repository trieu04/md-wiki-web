import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiData, useApi } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import type { SearchRequest } from './model';

export function useSearchResults(request: SearchRequest) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.search(request),
    queryFn: async ({ signal }) =>
      apiData(await api.GET('/api/v1/search', { params: { query: request }, signal })),
    enabled: Boolean(request.q),
    placeholderData: keepPreviousData,
  });
}
