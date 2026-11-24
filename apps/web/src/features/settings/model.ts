import type { components } from '@md-wiki/contracts';
import { formatDate, formatDateTime, roleAllowsScope, validateGateChange } from '@md-wiki/domain';
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

/** F-14 tab order and copy. People and Agents (D-49), Models from Phase 7 (D-151), Review from Phase 8 (D-221), Trust labels from Phase 9 (D-240). */
export const SETTINGS_TABS = [
  { id: 'review', label: 'Review and publishing', implemented: true },
  { id: 'trust', label: 'Trust labels', implemented: true },
  { id: 'people', label: 'People and teams', implemented: true },
  { id: 'agents', label: 'Agents and tokens', implemented: true },
  { id: 'models', label: 'Models', implemented: true },
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

// ---------- Models tab (P7-06, system-logic §7.6.7, D-151) ----------

export type ModelsDto = components['schemas']['ModelsDto'];
export type RulesDto = components['schemas']['RulesDto'];
export type ModelsRow = SettingsRow & {
  /** Drawn "locked" value (mono on `bg.row`): set outside the app. */
  locked: boolean;
  items: { key: string; text: string; note: string }[];
};

const JOB_LABEL: Record<ModelsDto['jobs'][number]['kind'], { label: string; help: string }> = {
  quality_check: {
    label: 'Quality check',
    help: 'Runs on every submission and on request. Set by the server environment.',
  },
};

const modelsRow = (
  key: string,
  label: string,
  help: string,
  value: string,
  note = '',
  extra: Partial<Pick<ModelsRow, 'locked' | 'items'>> = {},
): ModelsRow => ({ key, label, help, value, note, locked: false, items: [], ...extra });

/** F-14 *Models* rows from `/admin/models` and `/admin/rules`; read-only (D-140, D-151). */
export function modelsRows(models: ModelsDto, rules: RulesDto): ModelsRow[] {
  const jobs = models.jobs.map((job) => {
    const copy = JOB_LABEL[job.kind];
    const last = models.lastUsed.find(({ kind }) => kind === job.kind);
    const config = [
      job.provider,
      `up to ${String(job.maxTokens)} tokens`,
      `${String(job.timeoutS)} s timeout`,
      `${String(job.maxAttempts)} ${job.maxAttempts === 1 ? 'attempt' : 'attempts'}`,
      job.overridden ? 'set for this job' : 'default model',
    ].join(' · ');
    const used = last
      ? `Last used ${[last.model, last.promptVersion].filter(Boolean).join(' · ')}, ${formatDateTime(new Date(last.at))}.`
      : 'Not used yet.';
    return modelsRow(job.kind, copy.label, copy.help, job.model, `${config}. ${used}`);
  });
  const local = [
    ...new Set(
      models.jobs.filter(({ provider }) => provider === 'openai_compat').map(({ model }) => model),
    ),
  ];
  const endpoint = models.openaiCompat.baseUrl;
  const localRow = modelsRow(
    'local',
    'Local model',
    'OpenAI-compatible endpoint, for teams that can’t send text out.',
    endpoint ? [endpoint, ...local].join(' · ') : 'Not configured',
    endpoint
      ? local.length
        ? ''
        : 'No job uses it yet.'
      : 'Set OPENAI_COMPAT_BASE_URL in the server environment to use one.',
  );
  const rulesNote = rules.error
    ? `Not usable: ${rules.error}. Quality checks fail until the file is fixed.`
    : [
        `${String(rules.rules.length)} ${rules.rules.length === 1 ? 'rule' : 'rules'}`,
        rules.sha256 && `version ${rules.sha256.slice(0, 6)}`,
        rules.size !== null && `${String(rules.size)} bytes`,
      ]
        .filter(Boolean)
        .join(' · ');
  const rulesRow = modelsRow(
    'rules',
    'Quality rules',
    'What the quality check looks for. Edit the file; the next check uses it.',
    rules.path,
    rulesNote,
    {
      locked: true,
      items: rules.rules.map(({ id, title }) => ({ key: id, text: title, note: ` · ${id}` })),
    },
  );
  return [...jobs, localRow, rulesRow];
}

// ---- Review and publishing (F-14, Phase 8; system-logic §7.8.7, D-221) ----------------------

export type ReviewSettingsDto = components['schemas']['ReviewSettingsDto'];
export type ReviewSettingsInput = components['schemas']['ReviewSettingsInput'];

const PAGE_AUTHOR_TEXT: Record<ReviewSettingsDto['pageAuthors']['order'][number], string> = {
  owners_file: 'wiki-meta/owners.md',
  published_authors: 'people whose changes were published',
  owner: 'the owner',
};

const who = (u: { name: string } | null) => (u ? ` by ${u.name}` : '');

/** Read-only rows of the Review tab; the editable ones (model, spot checks, reminders) are the form. */
export function reviewRows(s: ReviewSettingsDto): ModelsRow[] {
  const agent = s.agent;
  const agentValue = !agent.user
    ? 'No reviewer agent account'
    : agent.paused
      ? `${agent.user.name} · paused`
      : agent.available
        ? `${agent.user.name} · running`
        : `${agent.user.name} · not running`;
  const agentNote = agent.paused
    ? `Paused${who(agent.pausedBy)}${agent.pausedAt ? `, ${formatDateTime(new Date(agent.pausedAt))}` : ''}${agent.pauseReason ? `: ${agent.pauseReason}` : ''}. Nothing is approved while paused; proposals wait.`
    : agent.tokenConfigured
      ? 'Acts through the public API with its own token.'
      : 'REVIEWER_AGENT_TOKEN is not set; the worker cannot act.';
  const owners = s.pageAuthors.ownersFile;
  return [
    modelsRow(
      'agent',
      'Reviewer agent',
      'Decides proposals in the self-managed model.',
      agentValue,
      agentNote,
    ),
    modelsRow(
      'auto-publish',
      'Auto-publish',
      'Set by the server environment.',
      `AUTO_PUBLISH=${String(s.autoPublish)}`,
      s.autoPublish
        ? 'Every approval is published at once through the normal conditional write.'
        : 'Approvals wait for a publisher.',
      { locked: true },
    ),
    modelsRow(
      'page-authors',
      'Page authors',
      'Who gets escalations for a page.',
      s.pageAuthors.order.map((o) => PAGE_AUTHOR_TEXT[o]).join(', then '),
      [
        `${String(owners.rules)} ${owners.rules === 1 ? 'rule' : 'rules'} in ${owners.path}`,
        owners.versionLabel,
        ...owners.warnings,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
    modelsRow(
      'quality',
      'Quality check',
      'Runs before the reviewer agent.',
      s.qualityCheck.onSubmit ? 'On every submission' : 'On request only',
      `Rules: ${s.qualityCheck.rulesPath}`,
      { locked: true },
    ),
  ];
}

/** The trigger list: built-ins are always on; only optional ones get a checkbox. */
export function triggerItems(s: ReviewSettingsDto) {
  return s.triggers.map((t) => ({
    id: t.id,
    text: t.title,
    note:
      t.source === 'custom'
        ? ` · owner rule${t.match ? ` (${t.match.kind}: ${t.match.value})` : ''}`
        : t.optional
          ? ''
          : ' · built-in',
    enabled: t.enabled,
    editable: t.optional,
  }));
}

export type ReviewDraft = {
  reviewModel: ReviewSettingsDto['reviewModel'];
  spotCheckPercent: string;
  reminderDays: string;
  agentEditsHumanPages: boolean;
};

export function reviewDraft(s: ReviewSettingsDto): ReviewDraft {
  return {
    reviewModel: s.reviewModel,
    spotCheckPercent: String(Math.round(s.spotCheckRate * 100)),
    reminderDays: String(s.reminderDays),
    agentEditsHumanPages:
      s.triggers.find((t) => t.id === 'agent_edits_human_pages')?.enabled ?? true,
  };
}

/** Only the changed fields; percent 0–100 (whole), days 1–30 (D-209, D-212). */
export function reviewSettingsInput(
  draft: ReviewDraft,
  current: ReviewSettingsDto,
): Validated<ReviewSettingsInput> {
  const fields: FieldErrors = {};
  const pct = draft.spotCheckPercent.trim();
  const days = draft.reminderDays.trim();
  const rate = Number(pct);
  const reminder = Number(days);
  if (!/^\d+$/u.test(pct) || rate > 100) fields.spotCheckRate = 'A whole number from 0 to 100.';
  if (!/^\d+$/u.test(days) || reminder < 1 || reminder > 30)
    fields.reminderDays = 'A whole number of days from 1 to 30.';
  if (Object.keys(fields).length) return { ok: false, fields };
  const base = reviewDraft(current);
  const input: ReviewSettingsInput = {
    ...(draft.reviewModel !== current.reviewModel && { reviewModel: draft.reviewModel }),
    ...(rate / 100 !== current.spotCheckRate && { spotCheckRate: rate / 100 }),
    ...(reminder !== current.reminderDays && { reminderDays: reminder }),
    ...(draft.agentEditsHumanPages !== base.agentEditsHumanPages && {
      agentEditsHumanPages: draft.agentEditsHumanPages,
    }),
  };
  return { ok: true, input };
}

export function reviewUpdatedText(s: ReviewSettingsDto) {
  return s.updatedAt
    ? `Last changed${who(s.updatedBy)}, ${formatDateTime(new Date(s.updatedAt))}.`
    : 'Defaults; never changed.';
}

// ---------- F-14 Trust labels: experiment gates (system-logic §7.7.10, 7d) ----------

export type CredibilityGateDto = components['schemas']['CredibilityGateDto'];

const GATE_TITLE: Record<CredibilityGateDto['capability'], string> = {
  label_threshold: 'Score thresholds move labels',
  recheck_ordering: 'Order re-checks by score',
  attestation_weights: 'Reader checks count',
  report_detection: 'Detect problems from reports',
  assistant_disclosure: 'Tell the assistant about credibility',
};

export function gateRow(gate: CredibilityGateDto) {
  return {
    key: gate.capability,
    title: GATE_TITLE[gate.capability],
    help: `${gate.description} Needs experiment ${gate.experiment}.`,
    enabled: gate.enabled,
    reference: gate.reference
      ? `Run ${gate.reference.runRecord} (${gate.reference.runDate})`
      : 'No experiment run recorded',
    updated:
      gate.updatedAt && gate.updatedBy
        ? `Changed by ${gate.updatedBy.name}, ${formatDate(new Date(gate.updatedAt))}`
        : null,
  };
}

/** Enabling needs the run record and date (domain `validateGateChange`); disabling needs nothing. */
export function gateInput(
  enabled: boolean,
  form: { runRecord: string; runDate: string },
  today: Date,
):
  | { ok: true; input: components['schemas']['GateInput'] }
  | { ok: false; errors: Partial<Record<'runRecord' | 'runDate', string>> } {
  if (!enabled) return { ok: true, input: { enabled: false } };
  const runRecord = form.runRecord.trim();
  const issues = validateGateChange({ enabled, runRecord, runDate: form.runDate }, today);
  if (issues.length)
    return {
      ok: false,
      errors: Object.fromEntries(issues.map(({ path, message }) => [path, `${message}.`])),
    };
  return { ok: true, input: { enabled, runRecord, runDate: form.runDate } };
}
