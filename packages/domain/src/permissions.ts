import type { ErrorCode } from './errors.js';

const rank = { reader: 0, contributor: 1, reviewer: 2, publisher: 3, owner: 4 } as const;
export type Role = keyof typeof rank;
export type Scope = 'read' | 'discuss' | 'contribute' | 'review' | 'publish';

// A null scope means no token can grant this permission, not an unscoped token.
const policies = {
  'wiki.read': ['reader', 'read'],
  search: ['reader', 'read'],
  'history.read': ['reader', 'read'],
  follow: ['reader', null],
  attest: ['reader', null],
  report: ['reader', null],
  feedback: ['reader', null],
  'topic.open': ['reader', 'discuss'],
  comment: ['contributor', 'discuss'],
  'draft.*': ['contributor', 'contribute'],
  'proposal.submit': ['contributor', 'contribute'],
  'proposal.read': ['reviewer', 'review'],
  'proposal.decide': ['reviewer', 'review'],
  'dispute.write': ['reviewer', 'review'],
  'proposal.publish': ['publisher', 'publish'],
  'credibility.decide': ['reviewer', null],
  'admin.*': ['owner', null],
} as const satisfies Record<string, readonly [Role, Scope | null]>;

export function roleAllowsScope(roles: readonly Role[], scope: Scope): boolean {
  return Object.values(policies).some(
    ([minimum, required]) =>
      required === scope && roles.some((role) => rank[role] >= rank[minimum]),
  );
}

type FamilyOrAction<T> = T extends `${infer Prefix}.*` ? `${Prefix}.${string}` : T;
export type Action = FamilyOrAction<keyof typeof policies>;

/** Authentication (including session/token validity) precedes this check. */
export interface PermissionActor {
  kind: 'human' | 'agent';
  roles: readonly Role[];
  auth: { kind: 'session' } | { kind: 'token'; scopes: readonly Scope[] };
}

/** Facts about this actor and the specific resource; absent facts never grant access. */
export interface PermissionContext {
  isOwnSectionVersion?: boolean;
  hasOpenAssignment?: boolean;
  isOwnProposal?: boolean;
  autoPublish?: boolean;
  isPageAuthor?: boolean;
  /** A human page author holding an escalation of this proposal (D-208). */
  isEscalationAssignee?: boolean;
}

/** Actions a page author may take on a proposal escalated to them, whatever their role (D-208). */
const ESCALATED_ACTIONS = new Set(['proposal.read', 'proposal.decide', 'dispute.write']);

export type PermissionDecision = { ok: true } | { ok: false; code: ErrorCode };
const forbidden = { ok: false, code: 'FORBIDDEN' } as const;

export function can(
  actor: PermissionActor,
  action: Action,
  ctx: PermissionContext,
): PermissionDecision {
  const key = action.startsWith('draft.')
    ? 'draft.*'
    : action.startsWith('admin.')
      ? 'admin.*'
      : action;
  if (!Object.hasOwn(policies, key)) return forbidden;
  const [role, scope] = policies[key as keyof typeof policies];
  const escalated =
    ctx.isEscalationAssignee === true &&
    actor.kind === 'human' &&
    actor.roles.length > 0 &&
    ESCALATED_ACTIONS.has(key);
  if (!escalated && !actor.roles.some((r) => rank[r] >= rank[role])) return forbidden;
  if (actor.auth.kind === 'token' && (scope === null || !actor.auth.scopes.includes(scope)))
    return forbidden;

  switch (action) {
    case 'follow':
    case 'attest':
    case 'report':
    case 'feedback':
      if (actor.kind !== 'human' || ctx.isOwnSectionVersion !== false) return forbidden;
      break;
    case 'proposal.decide':
      if (!ctx.hasOpenAssignment) return { ok: false, code: 'NOT_ASSIGNED' };
      if (ctx.isOwnProposal) return { ok: false, code: 'SELF_REVIEW' };
      if (ctx.isOwnProposal !== false) return forbidden;
      break;
    case 'proposal.publish':
      if (ctx.autoPublish !== false) return forbidden;
      break;
    case 'credibility.decide':
      if (!ctx.isPageAuthor) return forbidden;
      break;
  }
  return { ok: true };
}
