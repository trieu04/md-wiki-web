import type { components } from '@md-wiki/contracts';
import { formatDate, roleAllowsScope } from '@md-wiki/domain';
import { ApiError } from '../../lib/api';
import { errorCopy, messageForError } from '../../lib/error-copy';

export type UserDto = components['schemas']['UserDto'];
export type TeamDto = components['schemas']['TeamDto'];
export type ApiTokenDto = components['schemas']['ApiTokenDto'];
export type CreateUserInput = components['schemas']['CreateUserInput'];
export type UpdateUserInput = components['schemas']['UpdateUserInput'];
export type TokenInput = components['schemas']['TokenInput'];
type SessionDto = components['schemas']['SessionDto'];
export type Role = UserDto['roles'][number];
export type Scope = ApiTokenDto['scopes'][number];

/** Roles in rank order (system-logic §5.2). */
export const ROLES = [
  'reader',
  'contributor',
  'reviewer',
  'publisher',
  'owner',
] as const satisfies readonly Role[];
export const SCOPES = [
  'read',
  'discuss',
  'contribute',
  'review',
  'publish',
] as const satisfies readonly Scope[];

/** F-14 tab order and copy. Only People and Agents have data before Phase 7 (D-49). */
export const SETTINGS_TABS = [
  { id: 'review', label: 'Review and publishing', implemented: false },
  { id: 'trust', label: 'Trust labels', implemented: false },
  { id: 'people', label: 'People and teams', implemented: true },
  { id: 'agents', label: 'Agents and tokens', implemented: true },
  { id: 'models', label: 'Models', implemented: false },
  { id: 'storage', label: 'Storage', implemented: false },
] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export function settingsTab(value: unknown): SettingsTabId {
  return SETTINGS_TABS.find(({ id }) => id === value)?.id ?? 'people';
}

export type SettingsAccess = 'loading' | 'signed-out' | 'forbidden' | 'owner';

/** Settings content is owner-only (admin.*); everyone else gets the derived 403 (D-16, D-51). */
export function settingsAccess(session: SessionDto | undefined): SettingsAccess {
  if (!session) return 'loading';
  if (!session.user) return 'signed-out';
  return session.user.roles.includes('owner') ? 'owner' : 'forbidden';
}

export type SettingsRow = { key: string; label: string; help: string; value: string; note: string };

export function teamsSummary(teams: readonly Pick<TeamDto, 'name'>[], shown = 4): string {
  if (!teams.length) return 'No teams yet';
  const names = teams.slice(0, shown).map(({ name }) => name);
  const rest = teams.length - names.length;
  return rest > 0 ? `${names.join(', ')}, +${String(rest)}` : names.join(', ');
}

export function rolesText(roles: readonly Role[]): string {
  return ROLES.filter((role) => roles.includes(role)).join(' · ');
}

/** The People and teams summary rows drawn in F-14. */
export function peopleRows(teams: readonly Pick<TeamDto, 'name'>[]): SettingsRow[] {
  return [
    {
      key: 'sign-in',
      label: 'Sign-in',
      help: 'Local accounts for now.',
      value: 'Email and password · SSO later',
      note: '',
    },
    {
      key: 'teams',
      label: 'Teams',
      help: 'Used for team counts on attestations.',
      value: teamsSummary(teams),
      note: '',
    },
    {
      key: 'roles',
      label: 'Roles',
      help: 'Everyone can read and suggest. Roles add the Workspace.',
      value: rolesText(ROLES),
      note: '',
    },
  ];
}

export type UserRow = {
  id: string;
  name: string;
  email: string;
  kind: 'Person' | 'Agent';
  roles: string;
  team: string;
  status: 'Active' | 'Disabled';
  disabled: boolean;
};

export function userRows(users: readonly UserDto[], teams: readonly TeamDto[]): UserRow[] {
  const teamNames = new Map(teams.map(({ id, name }) => [id, name]));
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    kind: user.kind === 'agent' ? 'Agent' : 'Person',
    roles: rolesText(user.roles) || 'No role',
    team: user.teamId === null ? '—' : (teamNames.get(user.teamId) ?? '—'),
    status: user.disabled ? 'Disabled' : 'Active',
    disabled: user.disabled,
  }));
}

export type TokenRow = {
  id: string;
  label: string;
  help: string;
  value: string;
  note: string;
  revocable: boolean;
};

/** Token secrets never come back; the prefix's last four characters identify it (F-14 "Token …9f2a"). */
export function tokenValue({ prefix, scopes }: Pick<ApiTokenDto, 'prefix' | 'scopes'>): string {
  return `Token …${prefix.slice(-4)} · ${scopes.length ? `scopes ${scopes.join(', ')}` : 'no scopes'}`;
}

function tokenNote(token: ApiTokenDto, now: Date): string {
  if (token.revokedAt) return `Revoked ${formatDate(new Date(token.revokedAt))}`;
  const parts: string[] = [];
  if (token.expiresAt) {
    const expires = new Date(token.expiresAt);
    parts.push(`${expires <= now ? 'Expired' : 'Expires'} ${formatDate(expires)}`);
  }
  if (token.lastUsedAt) parts.push(`Last used ${formatDate(new Date(token.lastUsedAt))}`);
  return parts.join(' · ');
}

/**
 * One F-14 row per token (D-50): label = the account the token acts as, help = the token's
 * name (what it is for). Active tokens first, then revoked ones, each in API order.
 */
export function tokenRows(
  tokens: readonly ApiTokenDto[],
  users: readonly UserDto[],
  now: Date,
): TokenRow[] {
  const names = new Map(users.map(({ id, name }) => [id, name]));
  const rows = tokens.map((token) => ({
    id: token.id,
    label: names.get(token.userId) ?? 'Unknown account',
    help: token.name,
    value: tokenValue(token),
    note: tokenNote(token, now),
    revocable: token.revokedAt === null,
  }));
  return [...rows.filter((row) => row.revocable), ...rows.filter((row) => !row.revocable)];
}

export function allowedScopes(roles: readonly Role[]): Scope[] {
  return SCOPES.filter((scope) => roleAllowsScope(roles, scope));
}

/** Accounts that can hold a token: enabled ones (a disabled account's tokens are rejected). */
export function tokenAccounts(users: readonly UserDto[]) {
  return users
    .filter((user) => !user.disabled)
    .map((user) => ({
      id: user.id,
      label: `${user.name} (${user.kind === 'agent' ? 'agent' : user.email})`,
      scopes: allowedScopes(user.roles),
    }));
}

export type FieldErrors = Partial<Record<string, string>>;
export type Validated<T> = { ok: true; input: T } | { ok: false; fields: FieldErrors };

const emailPattern = /^[^\s@]+@[^\s@]+$/u;

export type NewUserDraft = {
  name: string;
  email: string;
  password: string;
  roles: readonly Role[];
  teamId: string;
};

export function createUserInput(draft: NewUserDraft): Validated<CreateUserInput> {
  const name = draft.name.trim();
  const email = draft.email.trim();
  const fields: FieldErrors = {};
  if (!name) fields.name = 'Enter a name.';
  if (!emailPattern.test(email)) fields.email = 'Enter a valid email address.';
  if (!draft.roles.length) fields.roles = 'Choose at least one role.';
  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    input: {
      name,
      email,
      roles: ROLES.filter((role) => draft.roles.includes(role)),
      teamId: draft.teamId || null,
      ...(draft.password && { password: draft.password }),
    },
  };
}

export type UserEditDraft = { roles: readonly Role[]; teamId: string };

/** Only changed fields are sent; `null` means nothing to save. */
export function updateUserInput(
  user: UserDto,
  draft: UserEditDraft,
): Validated<UpdateUserInput | null> {
  if (!draft.roles.length) return { ok: false, fields: { roles: 'Choose at least one role.' } };
  const roles = ROLES.filter((role) => draft.roles.includes(role));
  const teamId = draft.teamId || null;
  const input: UpdateUserInput = {};
  if (rolesText(roles) !== rolesText(user.roles)) input.roles = roles;
  if (teamId !== user.teamId) input.teamId = teamId;
  return { ok: true, input: Object.keys(input).length ? input : null };
}

export function teamInput(name: string): Validated<components['schemas']['TeamInput']> {
  const trimmed = name.trim();
  return trimmed
    ? { ok: true, input: { name: trimmed } }
    : { ok: false, fields: { name: 'Enter a team name.' } };
}

export type TokenDraft = { name: string; userId: string; scopes: readonly Scope[] };

export function tokenInput(
  draft: TokenDraft,
  accounts: ReturnType<typeof tokenAccounts>,
): Validated<TokenInput> {
  const name = draft.name.trim();
  const account = accounts.find(({ id }) => id === draft.userId);
  const scopes = SCOPES.filter((scope) => draft.scopes.includes(scope));
  const fields: FieldErrors = {};
  if (!name) fields.name = 'Enter what the token is for.';
  if (!account) fields.userId = 'Choose an account.';
  else if (!scopes.length) fields.scopes = 'Choose at least one scope.';
  else if (scopes.some((scope) => !account.scopes.includes(scope)))
    fields.scopes = 'A scope is not allowed for this account’s roles.';
  if (!account || Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, input: { name, userId: account.id, scopes } };
}

/**
 * Maps an API failure onto a form: field codes go under their field, everything else
 * (LAST_OWNER, FORBIDDEN, …) becomes the form message. Copy comes from error-copy.ts.
 */
export function settingsFormError(
  error: unknown,
  formFields: readonly string[],
): { message?: string; fields: FieldErrors } {
  if (error instanceof ApiError) {
    if (error.code === 'EMAIL_TAKEN' && formFields.includes('email'))
      return { fields: { email: errorCopy.EMAIL_TAKEN } };
    if (error.code === 'ALREADY_EXISTS' && formFields.includes('name'))
      return { fields: { name: errorCopy.ALREADY_EXISTS } };
    if (error.code === 'VALIDATION_FAILED') {
      const known = error.fields.filter((field) => formFields.includes(field));
      if (known.length)
        return {
          fields: Object.fromEntries(known.map((field) => [field, errorCopy.VALIDATION_FAILED])),
        };
    }
  }
  return { message: messageForError(error), fields: {} };
}
