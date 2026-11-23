import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@md-wiki/contracts';
import { apiData, useApi, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import type { CreateUserInput, TokenInput, UpdateUserInput } from './model';

type Page<T> = { items: T[]; nextCursor: string | null };

/** Settings shows whole lists; follow the cursor envelope to its end (system-logic §2). */
export async function fetchAll<T>(
  load: (query: { limit: number; cursor?: string }) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<T> = await load({ limit: 100, ...(cursor !== null && { cursor }) });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

const listQueries = (api: ApiClient) => ({
  users: {
    queryKey: queryKeys.adminUsers,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchAll(async (query) =>
        apiData(await api.GET('/api/v1/admin/users', { params: { query }, signal })),
      ),
  },
  teams: {
    queryKey: queryKeys.adminTeams,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchAll(async (query) =>
        apiData(await api.GET('/api/v1/admin/teams', { params: { query }, signal })),
      ),
  },
  tokens: {
    queryKey: queryKeys.adminTokens,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchAll(async (query) =>
        apiData(await api.GET('/api/v1/admin/tokens', { params: { query }, signal })),
      ),
  },
});

export function useAdminLists() {
  const queries = listQueries(useApi());
  return {
    users: useQuery(queries.users),
    teams: useQuery(queries.teams),
    tokens: useQuery(queries.tokens),
  };
}

/** F-14 *Models* (system-logic §7.6.7): effective model config and the parsed rules file. */
export function useModelsSettings() {
  const api = useApi();
  return {
    models: useQuery({
      queryKey: queryKeys.adminModels,
      queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/admin/models', { signal })),
    }),
    rules: useQuery({
      queryKey: queryKeys.adminRules,
      queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/admin/rules', { signal })),
    }),
  };
}

export function useAdminMutations() {
  const api = useApi();
  const queryClient = useQueryClient();
  const refresh = (key: readonly unknown[]) => () =>
    queryClient.invalidateQueries({ queryKey: key });
  return {
    createUser: useMutation({
      mutationFn: async (body: CreateUserInput) =>
        apiData(await api.POST('/api/v1/admin/users', { body })),
      onSuccess: refresh(queryKeys.adminUsers),
    }),
    updateUser: useMutation({
      mutationFn: async ({ id, body }: { id: string; body: UpdateUserInput }) =>
        apiData(await api.PATCH('/api/v1/admin/users/{id}', { params: { path: { id } }, body })),
      onSuccess: refresh(queryKeys.adminUsers),
    }),
    createTeam: useMutation({
      mutationFn: async (name: string) =>
        apiData(await api.POST('/api/v1/admin/teams', { body: { name } })),
      onSuccess: refresh(queryKeys.adminTeams),
    }),
    // The secret lives only in the creating component's state: never cached (shown once).
    createToken: useMutation({
      gcTime: 0,
      mutationFn: async (body: TokenInput) =>
        apiData(await api.POST('/api/v1/admin/tokens', { body })),
      onSuccess: refresh(queryKeys.adminTokens),
    }),
    revokeToken: useMutation({
      mutationFn: async (id: string) => {
        await api.DELETE('/api/v1/admin/tokens/{id}', { params: { path: { id } } });
      },
      onSuccess: refresh(queryKeys.adminTokens),
    }),
  };
}

/** F-14 Review and publishing (system-logic §7.8.7). */
export function useReviewSettings() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.reviewSettings,
    queryFn: async ({ signal }) =>
      apiData(await api.GET('/api/v1/admin/review-settings', { signal })),
  });
}

export function useReviewSettingsMutations() {
  const api = useApi();
  const queryClient = useQueryClient();
  const set = (data: components['schemas']['ReviewSettingsDto']) => {
    queryClient.setQueryData(queryKeys.reviewSettings, data);
  };
  return {
    update: useMutation({
      mutationFn: async (body: components['schemas']['ReviewSettingsInput']) =>
        apiData(await api.PATCH('/api/v1/admin/review-settings', { body })),
      onSuccess: set,
    }),
    pause: useMutation({
      mutationFn: async (body: components['schemas']['AgentPauseInput']) =>
        apiData(await api.POST('/api/v1/admin/agent/pause', { body })),
      onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviewSettings }),
    }),
  };
}
