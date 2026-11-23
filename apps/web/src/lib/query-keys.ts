import type { SearchRequest } from '../features/search/model';

export const queryKeys = {
  session: ['session', {}],
  meta: ['meta', {}],
  tree: ['wiki.tree', {}],
  recent: ['wiki.recent', { scope: 'all' }],
  search: (request: SearchRequest) => ['search', request] as const,
  page: (path: string) => ['wiki.page', { path }] as const,
  topic: (topic: string) => ['wiki.tree', { topic }] as const,
  history: (path: string) => ['wiki.history', { path }] as const,
  adminUsers: ['admin.users', {}],
  adminTeams: ['admin.teams', {}],
  adminTokens: ['admin.tokens', {}],
  draftOpen: (path: string, section: string | null) => ['draft.open', { path, section }] as const,
  draft: (id: string) => ['draft', id] as const,
  suggestions: ['me.suggestions', {}],
} as const;
