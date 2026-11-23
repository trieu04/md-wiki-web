import type { components } from '@md-wiki/contracts';
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { apiData, useApi, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import type { TopicDetailDto, TopicFilter, TopicListDto } from './model';

type S = components['schemas'];
const PAGE = 50;

export function topicsQueryOptions(api: ApiClient, filter: TopicFilter) {
  const key = queryKeys.topics({ filter, limit: PAGE });
  return infiniteQueryOptions<
    TopicListDto,
    Error,
    InfiniteData<TopicListDto>,
    typeof key,
    string | null
  >({
    queryKey: key,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        await api.GET('/api/v1/topics', {
          params: {
            query: { filter, limit: PAGE, ...(pageParam != null && { cursor: pageParam }) },
          },
          signal,
        }),
      ),
  });
}

/** Filter counts only (WorkNav), one item per request. */
export function topicCountsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.topics({ filter: 'open', limit: 1 }),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/topics', {
          params: { query: { filter: 'open', limit: 1 } },
          signal,
        }),
      ).counts,
  });
}

export function topicQueryOptions(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.discussionTopic(id),
    queryFn: async ({ signal }) =>
      apiData(await api.GET('/api/v1/topics/{id}', { params: { path: { id } }, signal })),
  });
}

export function proposalDiscussionQueryOptions(api: ApiClient, slug: string) {
  return queryOptions({
    queryKey: queryKeys.proposalDiscussion(slug),
    queryFn: async ({ signal }) =>
      apiData(
        await api.GET('/api/v1/proposals/{slug}/discussion', {
          params: { path: { slug } },
          signal,
        }),
      ),
  });
}

/** A topic write returns the topic: cache it and refresh lists and the proposal it holds. */
function topicWritten(queryClient: QueryClient, detail: TopicDetailDto) {
  queryClient.setQueryData(queryKeys.discussionTopic(detail.id), detail);
  void queryClient.invalidateQueries({ queryKey: ['topics'] });
  if (detail.proposal) proposalChanged(queryClient, detail.proposal.slug);
}

function proposalChanged(queryClient: QueryClient, slug: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.proposalDiscussion(slug) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.proposal(slug), exact: true });
  void queryClient.invalidateQueries({ queryKey: ['proposals'] });
}

export function useCreateTopic() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: S['TopicCreateInput']) =>
      apiData(await api.POST('/api/v1/topics', { body })),
    onSuccess(detail) {
      topicWritten(queryClient, detail);
    },
  });
}

export type ThreadWrite =
  | { kind: 'reply'; body: S['CommentInput'] }
  | { kind: 'close'; body: S['TopicCloseInput'] }
  | { kind: 'reopen'; body: S['TopicReopenInput'] };

export function useThreadWrite(id: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (write: ThreadWrite) => {
      const params = { path: { id } };
      switch (write.kind) {
        case 'reply':
          return apiData(
            await api.POST('/api/v1/topics/{id}/comments', { params, body: write.body }),
          );
        case 'close':
          return apiData(await api.POST('/api/v1/topics/{id}/close', { params, body: write.body }));
        case 'reopen':
          return apiData(
            await api.POST('/api/v1/topics/{id}/reopen', { params, body: write.body }),
          );
      }
    },
    onSuccess(detail) {
      topicWritten(queryClient, detail);
    },
  });
}

export function useOpenProposalDiscussion(slug: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: S['ProposalDiscussionInput']) =>
      apiData(
        await api.POST('/api/v1/proposals/{slug}/discussion', { params: { path: { slug } }, body }),
      ),
    onSuccess(discussion) {
      queryClient.setQueryData(queryKeys.proposalDiscussion(slug), discussion);
      if (discussion.topic)
        queryClient.setQueryData(queryKeys.discussionTopic(discussion.topic.id), discussion.topic);
      void queryClient.invalidateQueries({ queryKey: ['topics'] });
      proposalChanged(queryClient, slug);
    },
  });
}

export function useDispute(slug: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: S['DisputeInput']) =>
      apiData(
        await api.POST('/api/v1/proposals/{slug}/disputes', { params: { path: { slug } }, body }),
      ),
    onSuccess() {
      proposalChanged(queryClient, slug);
    },
  });
}
