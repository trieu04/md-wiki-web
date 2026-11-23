import type { components } from '@md-wiki/contracts';

type Role = components['schemas']['MeDto']['roles'][number];
type TabCounts = components['schemas']['TabCountsDto'];
type TopicCounts = components['schemas']['TopicCountsDto'];
type InboxCounts = components['schemas']['InboxDto']['counts'];

const WORK_ROLES = new Set<Role>(['reviewer', 'publisher', 'owner']);

/**
 * TopBar *Workspace* is for people with work there (D-95): roles ≥ reviewer. Open assignments go
 * only to roles ≥ reviewer until Phase 8 (system-logic §7.4.2), so the role check covers them.
 */
export function hasWorkspace(roles: readonly Role[] | undefined) {
  return !!roles?.some((role) => WORK_ROLES.has(role));
}

/**
 * WorkNav counts where data exists (D-95, D-118, D-215): Inbox = open items, Proposals = open,
 * Discussions = open topics the caller can see, Operations = blocked (owner).
 */
export function workNavCounts(
  counts: TabCounts | undefined,
  roles: readonly Role[] | undefined,
  topics?: TopicCounts,
  inbox?: InboxCounts,
) {
  if (!counts && !topics && !inbox) return undefined;
  return {
    ...(inbox && { inbox: inbox.all }),
    ...(counts && { proposals: counts.open }),
    ...(topics && { discussions: topics.open }),
    ...(counts && roles?.includes('owner') && { ops: counts.blocked }),
  };
}
