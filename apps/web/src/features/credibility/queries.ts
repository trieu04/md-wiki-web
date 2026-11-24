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
import { invalidateCredibility } from '../trust/queries';
import type {
  CredibilityPagesDto,
  CredibilityQueueDto,
  QueueItemDetailDto,
  QueueType,
} from './model';

type S = components['schemas'];
type SourcesDto = S['CredibilitySourcesDto'];

export function queueQueryOptions(api: ApiClient) {
  const key = queryKeys.credibilityQueue('all');
  return infiniteQueryOptions<
    CredibilityQueueDto,
    Error,
    InfiniteData<CredibilityQueueDto>,
    typeof key,
    string | null
  >({
    queryKey: key,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/credibility/queue', {
          params: { query: pageParam == null ? {} : { cursor: pageParam } },
          signal,
        }),
      ),
  });
}

export function queueItemQueryOptions(api: ApiClient, type: QueueType, id: string) {
  return queryOptions({
    queryKey: queryKeys.credibilityItem(type, id),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/credibility/queue/{type}/{id}', {
          params: { path: { type, id } },
          signal,
        }),
      ),
  });
}

export function pagesQueryOptions(api: ApiClient) {
  return infiniteQueryOptions<
    CredibilityPagesDto,
    Error,
    InfiniteData<CredibilityPagesDto>,
    typeof queryKeys.credibilityPages,
    string | null
  >({
    queryKey: queryKeys.credibilityPages,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/credibility/pages', {
          params: { query: pageParam == null ? {} : { cursor: pageParam } },
          signal,
        }),
      ),
  });
}

export function sourcesQueryOptions(api: ApiClient) {
  return infiniteQueryOptions<
    SourcesDto,
    Error,
    InfiniteData<SourcesDto>,
    typeof queryKeys.credibilitySources,
    string | null
  >({
    queryKey: queryKeys.credibilitySources,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/credibility/sources', {
          params: { query: pageParam == null ? {} : { cursor: pageParam } },
          signal,
        }),
      ),
  });
}

export function useDecide() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: S['CredibilityDecisionInput']) =>
      apiData(await api.POST('/api/v1/credibility/decisions', { body })),
    onSuccess: (detail: QueueItemDetailDto) => {
      client.setQueryData(queryKeys.credibilityItem(detail.type, detail.id), detail);
      return Promise.all([
        invalidateCredibility(client, detail.section?.path ?? ''),
        ...detail.downstream.map((section) => invalidateCredibility(client, section.path)),
      ]);
    },
  });
}

export function useRunRetractionCheck() {
  const api = useApi();
  return useMutation({
    mutationFn: async () =>
      apiData(
        await api.POST('/api/v1/credibility/jobs/{kind}', {
          params: { path: { kind: 'retraction_check' } },
        }),
      ),
  });
}

export function useExport() {
  const api = useApi();
  return useMutation({
    mutationFn: async () => apiData(await api.GET('/api/v1/credibility/export')),
  });
}
