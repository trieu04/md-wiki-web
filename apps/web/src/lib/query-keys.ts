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
  // Phase 5 (system-logic §7.4.11): prefixes `['proposals']`, `['proposal', slug]`, `['ops', …]`.
  proposals: (params: { tab: string; limit?: number }) => ['proposals', params] as const,
  proposal: (slug: string) => ['proposal', slug] as const,
  proposalDiff: (slug: string, against: 'base' | 'current') =>
    ['proposal', slug, 'diff', against] as const,
  opsBlocked: ['ops', 'blocked'],
  audit: ['ops', 'audit'],
  // Phase 6 (system-logic §7.5.7): prefixes `['topics']`, `['topic', id]`, `['proposal-discussion', slug]`.
  topics: (params: { filter: string; limit: number }) => ['topics', params] as const,
  discussionTopic: (id: string) => ['topic', id] as const,
  proposalDiscussion: (slug: string) => ['proposal-discussion', slug] as const,
} as const;
