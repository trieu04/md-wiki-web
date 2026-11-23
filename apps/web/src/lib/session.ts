import type { components } from '@md-wiki/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData, useApi, type ApiClient, type SessionDto } from './api';
import { queryKeys } from './query-keys';

export function sessionQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.session,
    queryFn: async ({ signal }) => apiData(await api.GET('/api/v1/auth/session', { signal })),
  });
}

export function useSession() {
  return useQuery(sessionQueryOptions(useApi()));
}

export function useLogin() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (body: components['schemas']['LoginInput']) =>
      apiData(await api.POST('/api/v1/auth/login', { body })),
    onSuccess(session) {
      queryClient.clear();
      queryClient.setQueryData<SessionDto>(queryKeys.session, session);
    },
  });
}

export function useLogout() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.POST('/api/v1/auth/logout');
    },
    onSuccess() {
      queryClient.clear();
      queryClient.setQueryData<SessionDto>(queryKeys.session, { user: null, csrfToken: null });
    },
  });
}
