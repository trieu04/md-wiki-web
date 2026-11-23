export const queryKeys = {
  session: ['session', {}],
  meta: ['meta', {}],
  page: (path: string) => ['wiki.page', { path }] as const,
} as const;
