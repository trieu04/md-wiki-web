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
import type { ProposalDetailDto, ProposalListDto, ProposalTab } from './model';

const PAGE = 50;

export function proposalsQueryOptions(api: ApiClient, tab: ProposalTab) {
  const key = queryKeys.proposals({ tab, limit: PAGE });
  return infiniteQueryOptions<
    ProposalListDto,
    Error,
    InfiniteData<ProposalListDto>,
    typeof key,
    string | null
  >({
    queryKey: key,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/proposals', {
          params: { query: { tab, limit: PAGE, ...(pageParam != null && { cursor: pageParam }) } },
          signal,
        }),
      ),
  });
}

/** Tab counts only (WorkNav and TopBar), one item per request. */
export function proposalCountsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.proposals({ tab: 'open', limit: 1 }),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/proposals', {
          params: { query: { tab: 'open', limit: 1 } },
          signal,
        }),
      ).counts,
  });
}

export function proposalQueryOptions(api: ApiClient, slug: string) {
  return queryOptions({
    queryKey: queryKeys.proposal(slug),
    queryFn: async ({ signal }) =>
      apiData(await api.GET('/api/v1/proposals/{slug}', { params: { path: { slug } }, signal })),
  });
}

export function proposalDiffQueryOptions(
  api: ApiClient,
  slug: string,
  against: 'base' | 'current' = 'base',
) {
  return queryOptions({
    queryKey: queryKeys.proposalDiff(slug, against),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/proposals/{slug}/diff', {
          params: { path: { slug }, query: { against } },
          signal,
        }),
      ),
  });
}

/** Writes return the new detail; cache it and refresh the lists that show it. */
function useDetailWrite<I>(
  slug: string,
  write: (api: ApiClient, input: I) => Promise<ProposalDetailDto>,
) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: I) => write(api, input),
    onSuccess(detail) {
      queryClient.setQueryData(queryKeys.proposal(slug), detail);
      void queryClient.invalidateQueries({ queryKey: ['proposal', slug, 'diff'] });
      void queryClient.invalidateQueries({ queryKey: ['proposals'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suggestions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.opsBlocked });
    },
  });
}

export function useDecide(slug: string) {
  return useDetailWrite(slug, async (api, body: components['schemas']['DecisionInput']) =>
    apiData(
      await api.POST('/api/v1/proposals/{slug}/decisions', { params: { path: { slug } }, body }),
    ),
  );
}

export function usePublish(slug: string) {
  return useDetailWrite(slug, async (api, _: undefined) =>
    apiData(await api.POST('/api/v1/proposals/{slug}/publish', { params: { path: { slug } } })),
  );
}

export function useWithdraw(slug: string) {
  return useDetailWrite(slug, async (api, body: components['schemas']['WithdrawInput']) =>
    apiData(
      await api.POST('/api/v1/proposals/{slug}/withdraw', { params: { path: { slug } }, body }),
    ),
  );
}
