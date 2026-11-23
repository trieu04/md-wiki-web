import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiData, useApi, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';

/** `GET /proposals/{slug}/findings` (system-logic §7.6.5). */
export function proposalQualityQueryOptions(api: ApiClient, slug: string) {
  return queryOptions({
    queryKey: queryKeys.quality(slug),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/proposals/{slug}/findings', { params: { path: { slug } }, signal }),
      ),
  });
}

/** `GET /drafts/{id}/self-check` (system-logic §7.6.6). */
export function selfCheckQueryOptions(api: ApiClient, draftId: string) {
  return queryOptions({
    queryKey: queryKeys.selfCheck(draftId),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/drafts/{id}/self-check', {
          params: { path: { id: draftId } },
          signal,
        }),
      ),
  });
}

/** *Re-run quality check*: 202 new run or 200 the active one; either way refetch the report. */
export function useRerunQuality(slug: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiData(
        await api.POST('/api/v1/proposals/{slug}/quality-check', { params: { path: { slug } } }),
      ),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quality(slug) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposal(slug), exact: true });
      void queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });
}

/** *Run self-check* / *Run again* on the saved draft (the caller flushes autosave first). */
export function useSelfCheck(draftId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiData(
        await api.POST('/api/v1/drafts/{id}/self-check', { params: { path: { id: draftId } } }),
      ),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.selfCheck(draftId) });
    },
  });
}
