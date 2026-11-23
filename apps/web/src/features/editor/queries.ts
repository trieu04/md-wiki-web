import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiData, ApiError, useApi, type ApiClient } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import { AUTOSAVE_MS, isEmptyPatch, settlePatch, type DraftDto, type DraftPatch } from './model';

const ifMatch = (draft: DraftDto) => ({ 'If-Match': `"${draft.updatedAt}"` });

/** Create-or-resume (D-62) is idempotent, so opening the editor is a query, not a mutation. */
export function openDraftQueryOptions(api: ApiClient, path: string, section: string | null) {
  return queryOptions({
    queryKey: queryKeys.draftOpen(path, section),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () =>
      apiData(await api.POST('/api/v1/drafts', { body: { targetPath: path, section } })),
  });
}

export function draftQueryOptions(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.draft(id),
    queryFn: async ({ signal }) =>
      apiData(await api.GET('/api/v1/drafts/{id}', { params: { path: { id } }, signal })),
  });
}

function useDraftCache() {
  const queryClient = useQueryClient();
  return {
    set(draft: DraftDto) {
      queryClient.setQueryData(queryKeys.draft(draft.id), draft);
      // A saved change can make the last self-check stale (draft digest, system-logic §7.6.6).
      void queryClient.invalidateQueries({ queryKey: queryKeys.selfCheck(draft.id) });
    },
    reload(id: string) {
      return queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) });
    },
    forget(id: string) {
      queryClient.removeQueries({ queryKey: queryKeys.draft(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suggestions });
    },
  };
}

/**
 * Debounced autosave (system-logic §7.2.9): one PATCH in flight, guarded by If-Match; local text
 * always wins locally. A PRECONDITION_FAILED reloads the draft and leaves the input in place.
 */
export function useDraftAutosave(draft: DraftDto) {
  const api = useApi();
  const cache = useDraftCache();
  const [pending, setPending] = useState<DraftPatch>({});
  const save = useMutation({
    mutationFn: async ({ patch, base }: { patch: DraftPatch; base: DraftDto }) =>
      apiData(
        await api.PATCH('/api/v1/drafts/{id}', {
          params: { path: { id: base.id }, header: ifMatch(base) },
          body: patch,
        }),
      ),
    onSuccess(saved, { patch }) {
      cache.set(saved);
      setPending((current) => settlePatch(current, patch));
    },
    onError(error) {
      if (error instanceof ApiError && error.code === 'PRECONDITION_FAILED')
        void cache.reload(draft.id);
    },
  });
  const failedOn = save.isError ? save.variables.patch : null;
  const { mutate } = save;
  useEffect(() => {
    if (isEmptyPatch(pending) || save.isPending || failedOn === pending) return;
    const timer = setTimeout(() => {
      mutate({ patch: pending, base: draft });
    }, AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pending, save.isPending, failedOn, mutate, draft]);
  return {
    pending,
    edit(patch: DraftPatch) {
      setPending((current) => ({ ...current, ...patch }));
    },
    saving: save.isPending || !isEmptyPatch(pending),
    error: save.error,
    /** Save now (before submit); resolves to the stored draft. */
    async flush(): Promise<DraftDto> {
      if (isEmptyPatch(pending)) return draft;
      return save.mutateAsync({ patch: pending, base: draft });
    },
  };
}

export function useDraftActions(id: string) {
  const api = useApi();
  const cache = useDraftCache();
  const path = { id };
  return {
    rebase: useMutation({
      mutationFn: async (mode: 'auto' | 'keep_mine') =>
        apiData(await api.POST('/api/v1/drafts/{id}/rebase', { params: { path }, body: { mode } })),
      onSuccess: (draft: DraftDto) => {
        cache.set(draft);
      },
    }),
    addSource: useMutation({
      mutationFn: async (source: string) =>
        apiData(
          await api.POST('/api/v1/drafts/{id}/sources', {
            params: { path },
            body: { path: source },
          }),
        ),
      onSuccess: (draft: DraftDto) => {
        cache.set(draft);
      },
    }),
    removeSource: useMutation({
      mutationFn: async (source: string) =>
        apiData(
          await api.DELETE('/api/v1/drafts/{id}/sources/{path}', {
            params: { path: { id, path: source } },
          }),
        ),
      onSuccess: (draft: DraftDto) => {
        cache.set(draft);
      },
    }),
    discard: useMutation({
      mutationFn: async () => {
        await api.DELETE('/api/v1/drafts/{id}', { params: { path } });
      },
      onSuccess: () => {
        cache.forget(id);
      },
    }),
    submit: useMutation({
      mutationFn: async (draft: DraftDto) =>
        apiData(
          await api.POST('/api/v1/drafts/{id}/submit', {
            params: { path, header: ifMatch(draft) },
          }),
        ),
      onSuccess: () => {
        cache.forget(id);
      },
    }),
    exportFile: useMutation({
      mutationFn: async () => {
        const result = await api.GET('/api/v1/drafts/{id}/export', {
          params: { path },
          parseAs: 'text',
        });
        const disposition = result.response.headers.get('Content-Disposition') ?? '';
        const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'draft.contribution.md';
        return { name, text: apiData<string>(result) };
      },
    }),
  };
}

/** Whole page: PATCH `scope: { section: null }` (the server splices the region). */
export function useWholePage(draft: DraftDto) {
  const api = useApi();
  const cache = useDraftCache();
  return useMutation({
    mutationFn: async () =>
      apiData(
        await api.PATCH('/api/v1/drafts/{id}', {
          params: { path: { id: draft.id }, header: ifMatch(draft) },
          body: { scope: { section: null } },
        }),
      ),
    onSuccess: (saved: DraftDto) => {
      cache.set(saved);
    },
  });
}
