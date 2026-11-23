import type { components } from '@md-wiki/contracts';

type Role = components['schemas']['MeDto']['roles'][number];
type TabCounts = components['schemas']['TabCountsDto'];

const WORK_ROLES = new Set<Role>(['reviewer', 'publisher', 'owner']);

/**
 * TopBar *Workspace* is for people with work there (D-95): roles ≥ reviewer. Open assignments go
 * only to roles ≥ reviewer until Phase 8 (system-logic §7.4.2), so the role check covers them.
 */
export function hasWorkspace(roles: readonly Role[] | undefined) {
  return !!roles?.some((role) => WORK_ROLES.has(role));
}

/** WorkNav counts where data exists (D-95): Proposals = open, Operations = blocked (owner). */
export function workNavCounts(counts: TabCounts | undefined, roles: readonly Role[] | undefined) {
  if (!counts) return undefined;
  return {
    proposals: counts.open,
    ...(roles?.includes('owner') && { ops: counts.blocked }),
  };
}
