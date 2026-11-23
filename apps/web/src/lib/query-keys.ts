export const queryKeys = {
  session: ['session', {}],
  meta: ['meta', {}],
  page: (path: string) => ['wiki.page', { path }] as const,
  topic: (topic: string) => ['wiki.tree', { topic }] as const,
  history: (path: string) => ['wiki.history', { path }] as const,
} as const;
