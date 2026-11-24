import type { components } from '@md-wiki/contracts';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiData, useApi, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import type { AttestationInput, ReportInput } from './model';

type S = components['schemas'];

export function whyQueryOptions(api: ApiClient, path: string, anchor: string) {
  return queryOptions({
    queryKey: queryKeys.why(path, anchor),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/sections/{path}/{anchor}/why', {
          params: { path: { path, anchor } },
          signal,
        }),
      ),
  });
}

export function peopleQueryOptions(api: ApiClient, path: string, anchor: string, reveal: boolean) {
  return queryOptions({
    queryKey: queryKeys.people(path, anchor, reveal),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/sections/{path}/{anchor}/people', {
          params: { path: { path, anchor }, query: reveal ? { reveal: 'true' } : {} },
          signal,
        }),
      ),
  });
}

/** Follows of the viewer (first page is enough to show *Following* on a page, D-171). */
export function followsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.follows,
    queryFn: async ({ signal }) =>
      apiData(await api.GET('/api/v1/me/follows', { params: { query: { limit: 100 } }, signal })),
  });
}

/** Every credibility write invalidates these (system-logic §7.7.13). */
export function invalidateCredibility(client: QueryClient, path: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.page(path) }),
    client.invalidateQueries({ queryKey: ['search'] }),
    client.invalidateQueries({ queryKey: ['why', path] }),
    client.invalidateQueries({ queryKey: ['people', path] }),
    client.invalidateQueries({ queryKey: ['credibility'] }),
    client.invalidateQueries({ queryKey: ['me.activity'] }),
    client.invalidateQueries({ queryKey: queryKeys.follows }),
  ]);
}

export function useTrustMutations(path: string) {
  const api = useApi();
  const client = useQueryClient();
  const settle = () => invalidateCredibility(client, path);
  return {
    attest: useMutation({
      mutationFn: async (body: AttestationInput) =>
        apiData(await api.POST('/api/v1/attestations', { body })),
      onSettled: settle,
    }),
    report: useMutation({
      mutationFn: async (body: ReportInput) => apiData(await api.POST('/api/v1/reports', { body })),
      onSettled: settle,
    }),
    withdraw: useMutation({
      mutationFn: async (id: string) =>
        apiData(
          await api.POST('/api/v1/attestations/{id}/withdraw', {
            params: { path: { id } },
            body: {},
          }),
        ),
      onSettled: settle,
    }),
  };
}

export function usePageFeedback() {
  const api = useApi();
  return useMutation({
    mutationFn: async (body: S['PageFeedbackInput']) =>
      apiData(await api.POST('/api/v1/page-feedback', { body })),
  });
}

export function useFollowMutations() {
  const api = useApi();
  const client = useQueryClient();
  const settle = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.follows }),
      client.invalidateQueries({ queryKey: ['me.notices'] }),
      client.invalidateQueries({ queryKey: ['wiki.recent'] }),
    ]);
  return {
    follow: useMutation({
      mutationFn: async (body: S['FollowInput']) =>
        apiData(await api.POST('/api/v1/follows', { body })),
      onSettled: settle,
    }),
    unfollow: useMutation({
      mutationFn: async ({ path, anchor }: { path: string; anchor?: string | null }) => {
        await api.DELETE('/api/v1/follows', {
          params: { query: { path, ...(anchor && { anchor }) } },
        });
      },
      onSettled: settle,
    }),
  };
}
