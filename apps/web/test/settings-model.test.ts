import { describe, expect, it } from 'vitest';
import { visualTeams, visualTokens, visualUsers } from '../src/dev/fixtures/settings';
import { ApiError } from '../src/lib/api';
import { errorCopy } from '../src/lib/error-copy';
import {
  allowedScopes,
  createUserInput,
  peopleRows,
  rolesText,
  settingsAccess,
  settingsFormError,
  settingsTab,
  SETTINGS_TABS,
  teamInput,
  teamsSummary,
  tokenAccounts,
  tokenInput,
  tokenRows,
  tokenValue,
  updateUserInput,
  userRows,
  type ApiTokenDto,
  type UserDto,
} from '../src/features/settings/model';

const now = new Date('2026-11-23T12:00:00Z');
const me = {
  id: '00000000-0000-4000-8000-000000000000',
  email: 'o@example.test',
  name: 'Owner',
  kind: 'human',
  teamId: null,
} as const;

describe('settings tabs and access', () => {
  it('lists the six F-14 tabs in frame order and defaults to People and teams', () => {
    expect(SETTINGS_TABS.map(({ label }) => label)).toEqual([
      'Review and publishing',
      'Trust labels',
      'People and teams',
      'Agents and tokens',
      'Models',
      'Storage',
    ]);
    expect(SETTINGS_TABS.filter((tab) => tab.implemented).map(({ id }) => id)).toEqual([
      'review',
      'people',
      'agents',
      'models',
    ]);
    expect(settingsTab('agents')).toBe('agents');
    expect(settingsTab('models')).toBe('models');
    expect(settingsTab('trust')).toBe('trust');
    expect(settingsTab(undefined)).toBe('people');
    expect(settingsTab('nope')).toBe('people');
    expect(settingsTab(['agents'])).toBe('people');
  });

  it('gives the content to owners only', () => {
    expect(settingsAccess(undefined)).toBe('loading');
    expect(settingsAccess({ user: null, csrfToken: null })).toBe('signed-out');
    for (const roles of [[], ['reader'], ['reviewer', 'publisher']] as const)
      expect(settingsAccess({ user: { ...me, roles: [...roles] }, csrfToken: 'x' })).toBe(
        'forbidden',
      );
    expect(settingsAccess({ user: { ...me, roles: ['reader', 'owner'] }, csrfToken: 'x' })).toBe(
      'owner',
    );
  });
});

describe('People and teams', () => {
  it('reproduces the F-14 summary rows from the team list', () => {
    expect(peopleRows(visualTeams).map(({ label, value }) => [label, value])).toEqual([
      ['Sign-in', 'Email and password · SSO later'],
      ['Teams', 'Imaging core, Light-sheet, Cell biology, Image analysis, +5'],
      ['Roles', 'reader · contributor · reviewer · publisher · owner'],
    ]);
  });

  it('summarises short and empty team lists without a "+N"', () => {
    expect(teamsSummary([])).toBe('No teams yet');
    expect(teamsSummary([{ name: 'A' }])).toBe('A');
    expect(teamsSummary([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])).toBe(
      'A, B, C, D',
    );
    expect(teamsSummary(['A', 'B', 'C', 'D', 'E'].map((name) => ({ name })))).toBe(
      'A, B, C, D, +1',
    );
  });

  it('orders roles by rank regardless of input order', () => {
    expect(rolesText(['owner', 'reader'])).toBe('reader · owner');
    expect(rolesText([])).toBe('');
  });

  it('maps users with team names, kind and status', () => {
    const rows = userRows(visualUsers, visualTeams);
    expect(rows[0]).toMatchObject({
      name: 'm.nguyen',
      roles: 'owner',
      team: 'Imaging core',
      status: 'Active',
      kind: 'Person',
    });
    expect(rows[3]).toMatchObject({ status: 'Disabled', disabled: true, team: 'Light-sheet' });
    expect(rows[4]).toMatchObject({ kind: 'Agent', team: '—' });
    // An unknown team id (deleted or not yet loaded) and no role.
    const orphan = { ...visualUsers[0], teamId: 'missing', roles: [] } as UserDto;
    expect(userRows([orphan], visualTeams)[0]).toMatchObject({ team: '—', roles: 'No role' });
  });
});

describe('user forms', () => {
  const draft = {
    name: '  Ana  ',
    email: ' ana@example.test ',
    password: '',
    roles: ['owner', 'reader'] as const,
    teamId: '',
  };

  it('trims, orders roles, maps "no team" to null and omits an empty password', () => {
    expect(createUserInput(draft)).toEqual({
      ok: true,
      input: { name: 'Ana', email: 'ana@example.test', roles: ['reader', 'owner'], teamId: null },
    });
    expect(createUserInput({ ...draft, password: 'pw', teamId: 't' })).toMatchObject({
      input: { password: 'pw', teamId: 't' },
    });
  });

  it('rejects a blank name, a bad email and no role', () => {
    expect(createUserInput({ ...draft, name: ' ', email: 'ana', roles: [] })).toEqual({
      ok: false,
      fields: {
        name: 'Enter a name.',
        email: 'Enter a valid email address.',
        roles: 'Choose at least one role.',
      },
    });
    expect(createUserInput({ ...draft, email: 'a b@c' }).ok).toBe(false);
  });

  it('sends only changed fields when editing roles or team', () => {
    const user = visualUsers[1] as UserDto;
    expect(updateUserInput(user, { roles: ['reviewer'], teamId: user.teamId ?? '' })).toEqual({
      ok: true,
      input: null,
    });
    expect(updateUserInput(user, { roles: ['publisher', 'reviewer'], teamId: '' })).toEqual({
      ok: true,
      input: { roles: ['reviewer', 'publisher'], teamId: null },
    });
    expect(updateUserInput(user, { roles: [], teamId: '' })).toMatchObject({ ok: false });
  });

  it('validates team names', () => {
    expect(teamInput('  Histology ')).toEqual({ ok: true, input: { name: 'Histology' } });
    expect(teamInput('   ')).toEqual({ ok: false, fields: { name: 'Enter a team name.' } });
  });
});

describe('Agents and tokens', () => {
  it('reproduces the F-14 agent rows', () => {
    expect(tokenRows(visualTokens, visualUsers, now)).toEqual([
      {
        id: visualTokens[0]?.id,
        label: 'reviewer-agent',
        help: 'Decides proposals.',
        value: 'Token …9f2a · scopes review, discuss',
        note: '',
        revocable: true,
      },
      {
        id: visualTokens[1]?.id,
        label: 'lab-agent',
        help: 'Submits proposals through the API and MCP.',
        value: 'Token …41c0 · scopes contribute',
        note: '',
        revocable: true,
      },
    ]);
  });

  it('notes revoked, expired, expiring and used tokens and lists revoked ones last', () => {
    const base = visualTokens[0] as ApiTokenDto;
    const tokens: ApiTokenDto[] = [
      { ...base, id: 'r', revokedAt: '2026-11-20T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' },
      { ...base, id: 'x', expiresAt: '2026-11-23T12:00:00Z' },
      { ...base, id: 'e', expiresAt: '2027-02-21T00:00:00Z', lastUsedAt: '2026-11-22T08:00:00Z' },
      { ...base, id: 'u', userId: 'gone', scopes: [] },
    ];
    expect(
      tokenRows(tokens, visualUsers, now).map(({ id, note, revocable, label }) => [
        id,
        note,
        revocable,
        label,
      ]),
    ).toEqual([
      ['x', 'Expired 23 Nov', true, 'reviewer-agent'],
      ['e', 'Expires 21 Feb · Last used 22 Nov', true, 'reviewer-agent'],
      ['u', '', true, 'Unknown account'],
      ['r', 'Revoked 20 Nov', false, 'reviewer-agent'],
    ]);
    expect(tokenValue({ prefix: 'ab', scopes: [] })).toBe('Token …ab · no scopes');
  });

  it('offers only scopes the account’s roles allow, and only enabled accounts', () => {
    expect(allowedScopes(['reader'])).toEqual(['read', 'discuss']);
    expect(allowedScopes(['contributor'])).toEqual(['read', 'discuss', 'contribute']);
    expect(allowedScopes(['owner'])).toEqual([
      'read',
      'discuss',
      'contribute',
      'review',
      'publish',
    ]);
    expect(allowedScopes([])).toEqual([]);
    const accounts = tokenAccounts(visualUsers);
    expect(accounts.map(({ label }) => label)).not.toContain('a.perez (ap@example.test)');
    expect(accounts.find(({ label }) => label.startsWith('lab-agent'))).toMatchObject({
      label: 'lab-agent (agent)',
      scopes: ['read', 'discuss', 'contribute'],
    });
  });

  it('validates the token form against the chosen account', () => {
    const accounts = tokenAccounts(visualUsers);
    const lab = accounts.find(({ label }) => label.startsWith('lab-agent'));
    const userId = lab?.id ?? '';
    expect(tokenInput({ name: ' bot ', userId, scopes: ['contribute', 'read'] }, accounts)).toEqual(
      { ok: true, input: { name: 'bot', userId, scopes: ['read', 'contribute'] } },
    );
    expect(tokenInput({ name: '', userId: '', scopes: [] }, accounts)).toEqual({
      ok: false,
      fields: { name: 'Enter what the token is for.', userId: 'Choose an account.' },
    });
    expect(tokenInput({ name: 'x', userId, scopes: [] }, accounts)).toMatchObject({
      fields: { scopes: 'Choose at least one scope.' },
    });
    expect(tokenInput({ name: 'x', userId, scopes: ['publish'] }, accounts)).toMatchObject({
      fields: { scopes: expect.stringContaining('not allowed') as unknown },
    });
  });
});

describe('form errors use error-copy.ts', () => {
  it('puts EMAIL_TAKEN under the email field', () => {
    expect(settingsFormError(new ApiError('EMAIL_TAKEN', 409), ['email'])).toEqual({
      fields: { email: errorCopy.EMAIL_TAKEN },
    });
  });
  it('shows LAST_OWNER as the form message', () => {
    expect(settingsFormError(new ApiError('LAST_OWNER', 409), ['roles'])).toEqual({
      message: 'At least one owner must be able to sign in.',
      fields: {},
    });
  });
  it('maps VALIDATION_FAILED field paths that the form has, else a form message', () => {
    expect(
      settingsFormError(new ApiError('VALIDATION_FAILED', 400, null, null, ['scopes']), ['scopes']),
    ).toEqual({ fields: { scopes: errorCopy.VALIDATION_FAILED } });
    expect(
      settingsFormError(new ApiError('VALIDATION_FAILED', 400, null, null, ['other']), ['name']),
    ).toEqual({ message: errorCopy.VALIDATION_FAILED, fields: {} });
  });
  it('maps a duplicate team name to the name field and unknown failures to INTERNAL', () => {
    expect(settingsFormError(new ApiError('ALREADY_EXISTS', 409), ['name'])).toEqual({
      fields: { name: errorCopy.ALREADY_EXISTS },
    });
    expect(settingsFormError(new Error('boom'), ['name'])).toEqual({
      message: errorCopy.INTERNAL,
      fields: {},
    });
  });
});
