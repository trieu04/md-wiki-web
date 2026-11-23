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
import type { InboxDto, InboxTab } from './model';

type S = components['schemas'];
const PAGE = 50;

export function inboxQueryOptions(api: ApiClient, tab: InboxTab) {
  const key = queryKeys.inbox({ tab });
  return infiniteQueryOptions<InboxDto, Error, InfiniteData<InboxDto>, typeof key, string | null>({
    queryKey: key,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/inbox', {
          params: { query: { tab, limit: PAGE, ...(pageParam != null && { cursor: pageParam }) } },
          signal,
        }),
      ),
  });
}

/** Counts only (WorkNav), one item per request. */
export function inboxCountsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.inboxCounts,
    queryFn: async ({ signal }) =>
      apiData(await api.GET('/api/v1/inbox', { params: { query: { limit: 1 } }, signal })).counts,
  });
}

export function escalationQueryOptions(api: ApiClient, slug: string) {
  return queryOptions({
    queryKey: queryKeys.escalation(slug),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/proposals/{slug}/escalation', {
          params: { path: { slug } },
          signal,
        }),
      ),
  });
}

export function useSpotCheckOutcome(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: S['SpotCheckInput']) =>
      apiData(
        await api.POST('/api/v1/spot-checks/{id}/outcome', { params: { path: { id } }, body }),
      ),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['inbox'] }),
        client.invalidateQueries({ queryKey: ['escalation'] }),
      ]),
  });
}

export function useEscalate(slug: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: S['EscalationInput']) =>
      apiData(
        await api.POST('/api/v1/proposals/{slug}/escalations', {
          params: { path: { slug } },
          body,
        }),
      ),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.escalation(slug), data);
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.proposal(slug) }),
        client.invalidateQueries({ queryKey: ['inbox'] }),
      ]),
  });
}
