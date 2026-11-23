import { describe, expect, it } from 'vitest';
import {
  can,
  roleAllowsScope,
  type Action,
  type PermissionActor,
  type Role,
  type Scope,
} from '../src/index.js';

const reader: Role[] = ['reader', 'contributor', 'reviewer', 'publisher', 'owner'];
const contributor = reader.slice(1);
const reviewer = reader.slice(2);
const publisher = reader.slice(3);
const scopes: Scope[] = ['read', 'discuss', 'contribute', 'review', 'publish'];
const observerActions = ['follow', 'attest', 'report', 'feedback'] as const;
const ctx = {
  isOwnSectionVersion: false,
  hasOpenAssignment: true,
  isOwnProposal: false,
  autoPublish: false,
  isPageAuthor: true,
};
const owner = { kind: 'human', roles: ['owner'], auth: { kind: 'session' } } as const;
const forbidden = { ok: false, code: 'FORBIDDEN' };

// Independent expectation table. Exercise every subset of token scopes, including empty and full.
const matrix: {
  actions: readonly Action[];
  roles: Role[];
  scope: Scope | null;
  humanOnly?: boolean;
}[] = [
  { actions: ['wiki.read', 'search', 'history.read'], roles: reader, scope: 'read' },
  { actions: observerActions, roles: reader, scope: null, humanOnly: true },
  { actions: ['topic.open'], roles: reader, scope: 'discuss' },
  { actions: ['comment'], roles: contributor, scope: 'discuss' },
  {
    actions: ['draft.*', 'draft.create', 'draft.update', 'proposal.submit'],
    roles: contributor,
    scope: 'contribute',
  },
  {
    actions: ['proposal.read', 'proposal.decide', 'dispute.write'],
    roles: reviewer,
    scope: 'review',
  },
  { actions: ['proposal.publish'], roles: publisher, scope: 'publish' },
  { actions: ['credibility.decide'], roles: reviewer, scope: null },
  {
    actions: [
      'admin.*',
      'admin.users',
      'admin.tokens',
      'admin.settings',
      'admin.reindex',
      'admin.recovery',
    ],
    roles: ['owner'],
    scope: null,
  },
];
const credentials: PermissionActor['auth'][] = [{ kind: 'session' }];
for (let mask = 0; mask < 2 ** scopes.length; mask++) {
  credentials.push({ kind: 'token', scopes: scopes.filter((_, i) => (mask & (1 << i)) !== 0) });
}

describe('§5.2 permissions', () => {
  it('grants only scopes with an action available at the target role', () => {
    for (const role of reader)
      for (const scope of scopes)
        expect(roleAllowsScope([role], scope)).toBe(
          matrix.some((row) => row.scope === scope && row.roles.includes(role)),
        );
    expect(roleAllowsScope([], 'read')).toBe(false);
  });
  for (const row of matrix) {
    it.each(row.actions)('%s: roles × credential scopes × actor kinds', (action) => {
      for (const role of reader)
        for (const auth of credentials)
          for (const kind of ['human', 'agent'] as const) {
            const allowed =
              row.roles.includes(role) &&
              (!row.humanOnly || kind === 'human') &&
              (auth.kind === 'session' || (row.scope !== null && auth.scopes.includes(row.scope)));
            expect(
              can({ kind, roles: [role], auth }, action, ctx),
              JSON.stringify({ role, auth, kind }),
            ).toEqual(allowed ? { ok: true } : forbidden);
          }
    });
  }

  it.each(observerActions)(
    '%s excludes own section version and requires known ownership',
    (action) => {
      expect(can(owner, action, { ...ctx, isOwnSectionVersion: true })).toEqual(forbidden);
      expect(can(owner, action, {})).toEqual(forbidden);
    },
  );
  it('requires an open assignment before checking for self-review, even for owners', () => {
    expect(
      can(owner, 'proposal.decide', { ...ctx, hasOpenAssignment: false, isOwnProposal: true }),
    ).toEqual({ ok: false, code: 'NOT_ASSIGNED' });
    expect(can(owner, 'proposal.decide', { ...ctx, isOwnProposal: true })).toEqual({
      ok: false,
      code: 'SELF_REVIEW',
    });
    expect(can(owner, 'proposal.decide', { hasOpenAssignment: true })).toEqual(forbidden);
  });
  it('requires manual publication and path-specific authorship respectively', () => {
    expect(can(owner, 'proposal.publish', { ...ctx, autoPublish: true })).toEqual(forbidden);
    expect(can(owner, 'proposal.publish', {})).toEqual(forbidden);
    expect(can(owner, 'credibility.decide', { ...ctx, isPageAuthor: false })).toEqual(forbidden);
  });
  it('honors any qualifying role but grants nothing for an empty roles list', () => {
    expect(can({ ...owner, roles: ['reviewer', 'reader'] }, 'proposal.decide', ctx)).toEqual({
      ok: true,
    });
    expect(can({ ...owner, roles: [] }, 'wiki.read', ctx)).toEqual(forbidden);
  });
});
