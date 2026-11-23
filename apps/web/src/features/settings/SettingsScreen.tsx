import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { messageForError, errorCopy } from '../../lib/error-copy';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Card } from '../../ui/Card';
import { Checkbox } from '../../ui/Checkbox';
import { Mono } from '../../ui/Mono';
import { QueryFailure } from '../../ui/QueryFailure';
import { Select } from '../../ui/Select';
import { Table } from '../../ui/Table';
import { Tabs } from '../../ui/Tabs';
import { TextInput } from '../../ui/TextInput';
import type { TopBarProps } from '../../ui/TopBar';
import { WorkspaceLayout } from '../../ui/WorkspaceLayout';
import {
  ROLES,
  SETTINGS_TABS,
  createUserInput,
  peopleRows,
  settingsAccess,
  settingsFormError,
  teamInput,
  tokenAccounts,
  tokenInput,
  tokenRows,
  updateUserInput,
  userRows,
  type FieldErrors,
  type Role,
  type Scope,
  type SettingsRow,
  type SettingsTabId,
  type TeamDto,
  type UserDto,
} from './model';
import { useAdminLists, useAdminMutations } from './queries';

type FormState = { message?: string | undefined; fields: FieldErrors };
const noErrors: FormState = { fields: {} };

/** F-14 row: label and help on the left, the value (and its note) on the right. */
function Row({
  label,
  help,
  value,
  note,
  children,
}: Omit<SettingsRow, 'key'> & { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-24px gap-y-8px border-b border-row py-14px">
      <div className="flex min-w-0 shrink grow basis-settings-label flex-col gap-2px">
        <span className="font-semibold">{label}</span>
        <span className="text-13 text-muted">{help}</span>
      </div>
      <div className="flex min-w-0 shrink grow basis-settings-value flex-col gap-6px">
        <span className="rounded-8 border border-control bg-surface px-10px py-7px">{value}</span>
        <span className="text-12 text-muted">{note}</span>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-12px pt-20px">
      <h2 className="text-16 font-bold">{title}</h2>
      {children}
    </section>
  );
}

function FormFailure({ title, message }: { title: string; message: string | undefined }) {
  return message ? (
    <Callout tone="error" title={title}>
      {message}
    </Callout>
  ) : null;
}

function RoleChoices({
  name,
  roles,
  onChange,
  error,
}: {
  name: string;
  roles: readonly Role[];
  onChange: (roles: Role[]) => void;
  error?: string | undefined;
}) {
  const errorId = `${name}-roles-error`;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-4px"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="font-semibold">Roles</legend>
      <div className="flex flex-wrap gap-x-16px">
        {ROLES.map((role) => (
          <Checkbox
            key={role}
            label={role}
            checked={roles.includes(role)}
            onChange={(event) => {
              onChange(
                event.target.checked ? [...roles, role] : roles.filter((item) => item !== role),
              );
            }}
          />
        ))}
      </div>
      {error && (
        <p id={errorId} className="text-12 text-trust-error-fg">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function TeamSelect({
  teams,
  value,
  onChange,
}: {
  teams: readonly TeamDto[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      label="Team"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <option value="">No team</option>
      {teams.map((team) => (
        <option key={team.id} value={team.id}>
          {team.name}
        </option>
      ))}
    </Select>
  );
}

function EditUser({
  user,
  teams,
  onDone,
}: {
  user: UserDto;
  teams: readonly TeamDto[];
  onDone: () => void;
}) {
  const { updateUser } = useAdminMutations();
  const [roles, setRoles] = useState<readonly Role[]>(user.roles);
  const [teamId, setTeamId] = useState(user.teamId ?? '');
  const [errors, setErrors] = useState<FormState>(noErrors);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = updateUserInput(user, { roles, teamId });
    if (!result.ok) {
      setErrors({ fields: result.fields });
      return;
    }
    if (!result.input) {
      onDone();
      return;
    }
    setErrors(noErrors);
    try {
      await updateUser.mutateAsync({ id: user.id, body: result.input });
      onDone();
    } catch (error) {
      setErrors(settingsFormError(error, ['roles', 'teamId']));
    }
  }

  return (
    <form
      aria-label={`Edit ${user.name}`}
      className="flex flex-col items-start gap-12px rounded-10 border border-edge px-18px py-16px"
      onSubmit={(event) => void onSubmit(event)}
    >
      <h3 className="text-14 font-bold">Edit {user.name}</h3>
      <RoleChoices name="edit" roles={roles} onChange={setRoles} error={errors.fields.roles} />
      <TeamSelect teams={teams} value={teamId} onChange={setTeamId} />
      <FormFailure title="Could not save." message={errors.message} />
      <div className="flex flex-wrap gap-8px">
        <Button type="submit" loading={updateUser.isPending}>
          Save
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddPerson({ teams }: { teams: readonly TeamDto[] }) {
  const { createUser } = useAdminMutations();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<readonly Role[]>(['reader']);
  const [teamId, setTeamId] = useState('');
  const [errors, setErrors] = useState<FormState>(noErrors);
  const [added, setAdded] = useState<string>();

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdded(undefined);
    const result = createUserInput({ name, email, password, roles, teamId });
    if (!result.ok) {
      setErrors({ fields: result.fields });
      return;
    }
    setErrors(noErrors);
    try {
      const user = await createUser.mutateAsync(result.input);
      setAdded(user.name);
      setName('');
      setEmail('');
      setPassword('');
      setRoles(['reader']);
      setTeamId('');
    } catch (error) {
      setErrors(settingsFormError(error, ['name', 'email', 'password', 'roles', 'teamId']));
    }
  }

  return (
    <form
      aria-label="Add a person"
      noValidate
      className="flex flex-col items-start gap-12px"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="flex w-full flex-wrap gap-12px [&>*]:grow [&>*]:basis-search-filter-basis">
        <TextInput
          label="Name"
          value={name}
          error={errors.fields.name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextInput
          label="Email"
          type="email"
          value={email}
          error={errors.fields.email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <TextInput
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="Optional. Without a password the person cannot sign in."
          value={password}
          error={errors.fields.password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <TeamSelect teams={teams} value={teamId} onChange={setTeamId} />
      </div>
      <RoleChoices name="new" roles={roles} onChange={setRoles} error={errors.fields.roles} />
      <FormFailure title="Could not add this person." message={errors.message} />
      {added && (
        <Callout tone="success" title="Person added">
          {added} can now be given a team, roles and tokens.
        </Callout>
      )}
      <Button type="submit" loading={createUser.isPending}>
        Add person
      </Button>
    </form>
  );
}

function AddTeam() {
  const { createTeam } = useAdminMutations();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FormState>(noErrors);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = teamInput(name);
    if (!result.ok) {
      setErrors({ fields: result.fields });
      return;
    }
    setErrors(noErrors);
    try {
      await createTeam.mutateAsync(result.input.name);
      setName('');
    } catch (error) {
      setErrors(settingsFormError(error, ['name']));
    }
  }

  return (
    <form
      aria-label="Add a team"
      noValidate
      className="flex flex-wrap items-end gap-12px"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="grow basis-search-filter-basis">
        <TextInput
          label="Team name"
          value={name}
          error={errors.fields.name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <Button type="submit" loading={createTeam.isPending}>
        Add team
      </Button>
      <div className="w-full empty:hidden">
        <FormFailure title="Could not add this team." message={errors.message} />
      </div>
    </form>
  );
}

function ListState({
  queries,
  title,
  children,
}: {
  queries: { isPending: boolean; error: unknown; refetch: () => unknown; isFetching: boolean }[];
  title: string;
  children: () => ReactNode;
}) {
  const failed = queries.find((query) => query.error);
  if (failed)
    return (
      <div className="pt-14px">
        <QueryFailure
          error={failed.error}
          busy={failed.isFetching}
          retry={() => {
            for (const query of queries) if (query.error) void query.refetch();
          }}
        />
      </div>
    );
  if (queries.some((query) => query.isPending))
    return (
      <div aria-busy="true" aria-label={title} className="flex flex-col gap-12px py-16px">
        {[1, 2, 3].map((row) => (
          <div key={row} className="h-12px bg-row" />
        ))}
      </div>
    );
  return children();
}

function PeoplePanel() {
  const lists = useAdminLists();
  const { updateUser } = useAdminMutations();
  const [editing, setEditing] = useState<string>();
  const [rowError, setRowError] = useState<string>();
  const users = useMemo(() => lists.users.data ?? [], [lists.users.data]);
  const teams = useMemo(() => lists.teams.data ?? [], [lists.teams.data]);
  const rows = useMemo(() => userRows(users, teams), [users, teams]);
  const editingUser = users.find(({ id }) => id === editing);

  async function setDisabled(id: string, disabled: boolean) {
    setRowError(undefined);
    try {
      await updateUser.mutateAsync({ id, body: { disabled } });
    } catch (error) {
      setRowError(messageForError(error));
    }
  }

  return (
    <ListState queries={[lists.users, lists.teams]} title="People and teams">
      {() => (
        <>
          {peopleRows(teams).map(({ key, ...row }) => (
            <Row key={key} {...row} />
          ))}
          <Section title="People">
            {rowError && (
              <Callout tone="error" title="Could not change this account.">
                {rowError}
              </Callout>
            )}
            <Table label="People" widthClass="min-w-table-settings">
              <thead>
                <tr>
                  {['Name', 'Email', 'Roles', 'Team', 'Status', 'Actions'].map((title) => (
                    <th key={title} scope="col" className="py-10px pr-14px">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="py-10px pr-14px">
                      <span className="font-semibold">{row.name}</span>
                      {row.kind === 'Agent' && <span className="text-muted"> · agent</span>}
                    </td>
                    <td className="py-10px pr-14px break-all">{row.email}</td>
                    <td className="py-10px pr-14px">{row.roles}</td>
                    <td className="py-10px pr-14px">{row.team}</td>
                    <td className={`py-10px pr-14px ${row.disabled ? 'text-muted' : ''}`}>
                      {row.status}
                    </td>
                    <td className="py-10px">
                      <div className="flex flex-wrap gap-x-12px gap-y-4px">
                        <Button
                          variant="link"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => {
                            setEditing(row.id);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="link"
                          aria-label={`${row.disabled ? 'Enable' : 'Disable'} ${row.name}`}
                          disabled={updateUser.isPending}
                          onClick={() => void setDisabled(row.id, !row.disabled)}
                        >
                          {row.disabled ? 'Enable' : 'Disable'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {editingUser && (
              <EditUser
                key={editingUser.id}
                user={editingUser}
                teams={teams}
                onDone={() => {
                  setEditing(undefined);
                }}
              />
            )}
          </Section>
          <Section title="Add a person">
            <AddPerson teams={teams} />
          </Section>
          <Section title="Add a team">
            <AddTeam />
          </Section>
        </>
      )}
    </ListState>
  );
}

function TokenRowActions({ id, label }: { id: string; label: string }) {
  const { revokeToken } = useAdminMutations();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  if (!confirming)
    return (
      <Button
        variant="link"
        className="self-start"
        aria-label={`Revoke token ${label}`}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Revoke
      </Button>
    );
  return (
    <div className="flex flex-col items-start gap-6px">
      <div className="flex flex-wrap items-center gap-8px">
        <Button
          variant="secondary-compact"
          loading={revokeToken.isPending}
          onClick={() => {
            setError(undefined);
            revokeToken.mutate(id, {
              onError: (failure) => {
                setError(messageForError(failure));
              },
            });
          }}
        >
          Revoke token
        </Button>
        <Button
          variant="link"
          onClick={() => {
            setConfirming(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-12 text-trust-error-fg">{error}</p>}
    </div>
  );
}

function CreateToken({ users }: { users: readonly UserDto[] }) {
  const { createToken } = useAdminMutations();
  const accounts = useMemo(() => tokenAccounts(users), [users]);
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [scopes, setScopes] = useState<readonly Scope[]>([]);
  const [errors, setErrors] = useState<FormState>(noErrors);
  const [created, setCreated] = useState<{ token: string; name: string }>();
  const allowed = accounts.find(({ id }) => id === userId)?.scopes ?? [];

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreated(undefined);
    const result = tokenInput({ name, userId, scopes }, accounts);
    if (!result.ok) {
      setErrors({ fields: result.fields });
      return;
    }
    setErrors(noErrors);
    try {
      const token = await createToken.mutateAsync(result.input);
      setCreated({ token: token.token, name: token.name });
      setName('');
      setScopes([]);
    } catch (error) {
      setErrors(settingsFormError(error, ['name', 'userId', 'scopes']));
    } finally {
      createToken.reset();
    }
  }

  return (
    <form
      aria-label="Create a token"
      noValidate
      className="flex flex-col items-start gap-12px"
      onSubmit={(event) => void onSubmit(event)}
    >
      {created && (
        <Callout tone="success" title="Token created">
          <span className="flex flex-col gap-6px">
            <span>Copy it now. It is shown only once.</span>
            <span className="rounded-8 bg-row px-10px py-7px text-13 break-all" data-token>
              <Mono>{created.token}</Mono>
            </span>
            <Button
              variant="link"
              className="self-start"
              onClick={() => {
                setCreated(undefined);
              }}
            >
              Done
            </Button>
          </span>
        </Callout>
      )}
      <div className="flex w-full flex-wrap gap-12px [&>*]:grow [&>*]:basis-search-filter-basis">
        <TextInput
          label="What it is for"
          value={name}
          error={errors.fields.name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Select
          label="Account"
          value={userId}
          error={errors.fields.userId}
          onChange={(event) => {
            setUserId(event.target.value);
            setScopes([]);
          }}
        >
          <option value="">Choose an account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </Select>
      </div>
      {userId && (
        <fieldset
          className="flex min-w-0 flex-col gap-4px"
          aria-invalid={errors.fields.scopes ? true : undefined}
          aria-describedby={errors.fields.scopes ? 'token-scopes-error' : undefined}
        >
          <legend className="font-semibold">Scopes</legend>
          {allowed.length ? (
            <div className="flex flex-wrap gap-x-16px">
              {allowed.map((scope) => (
                <Checkbox
                  key={scope}
                  label={scope}
                  checked={scopes.includes(scope)}
                  onChange={(event) => {
                    setScopes(
                      event.target.checked
                        ? [...scopes, scope]
                        : scopes.filter((item) => item !== scope),
                    );
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="text-13 text-muted">This account’s roles allow no token scopes.</p>
          )}
          {errors.fields.scopes && (
            <p id="token-scopes-error" className="text-12 text-trust-error-fg">
              {errors.fields.scopes}
            </p>
          )}
        </fieldset>
      )}
      <FormFailure title="Could not create the token." message={errors.message} />
      <Button type="submit" loading={createToken.isPending}>
        Create token
      </Button>
    </form>
  );
}

function AgentsPanel() {
  const lists = useAdminLists();
  const users = useMemo(() => lists.users.data ?? [], [lists.users.data]);
  const rows = useMemo(
    () => tokenRows(lists.tokens.data ?? [], users, new Date()),
    [lists.tokens.data, users],
  );
  return (
    <ListState queries={[lists.tokens, lists.users]} title="Agents and tokens">
      {() => (
        <>
          {rows.length ? (
            rows.map(({ id, revocable, ...row }) => (
              <Row key={id} {...row}>
                {revocable && <TokenRowActions id={id} label={row.help} />}
              </Row>
            ))
          ) : (
            <p className="border-b border-row py-14px text-13 text-muted">No tokens yet.</p>
          )}
          <Section title="Create a token">
            <CreateToken users={users} />
          </Section>
        </>
      )}
    </ListState>
  );
}

function SettingsContent({
  tab,
  onTab,
}: {
  tab: SettingsTabId;
  onTab: (tab: SettingsTabId) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2px">
        <h1 className="text-24 font-bold">Settings</h1>
        <span className="text-muted">Owner only. Every change is written to the audit log.</span>
      </div>
      <div className="overflow-hidden rounded-10 border border-edge bg-surface">
        <Tabs
          label="Settings"
          selected={tab}
          onChange={(id) => {
            onTab(id as SettingsTabId);
          }}
          tabs={SETTINGS_TABS.map(({ id, label, implemented }) => ({
            id,
            label,
            // Deferred tabs (review, trust, models, storage) have no data yet: no panel (D-49).
            panel:
              implemented && id === tab ? (
                <div className="px-22px pt-6px pb-22px">
                  {id === 'people' ? <PeoplePanel /> : <AgentsPanel />}
                </div>
              ) : null,
          }))}
        />
      </div>
    </>
  );
}

export function SettingsScreen({
  tab,
  onTab,
  topBar,
}: {
  tab: SettingsTabId;
  onTab: (tab: SettingsTabId) => void;
  topBar: TopBarProps;
}) {
  const session = useSession();
  const access = settingsAccess(session.data);
  return (
    <WorkspaceLayout topBar={topBar} workNav={{ active: 'settings' }}>
      {access === 'owner' ? (
        <SettingsContent tab={tab} onTab={onTab} />
      ) : access === 'loading' ? (
        session.error ? (
          <QueryFailure
            error={session.error}
            busy={session.isFetching}
            retry={() => void session.refetch()}
          />
        ) : (
          <Card title="Settings" heading="h1" state={{ type: 'loading' }} />
        )
      ) : (
        // Derived 403 (D-16, D-51): no settings content for anyone but an owner.
        <Card title="Settings" heading="h1" header>
          <div className="flex flex-col items-start gap-12px px-18px py-16px">
            <Callout tone="error" title="No access.">
              {access === 'signed-out' ? errorCopy.UNAUTHENTICATED : errorCopy.FORBIDDEN}
            </Callout>
            {access === 'signed-out' ? (
              <Link to="/login" search={{ next: '/work/settings' }}>
                Sign in
              </Link>
            ) : (
              <Link to="/">Back to the wiki</Link>
            )}
          </div>
        </Card>
      )}
    </WorkspaceLayout>
  );
}
