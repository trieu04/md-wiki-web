import 'reflect-metadata';
import { testSchema } from './test-schema.js';
import { createHash } from 'node:crypto';
import { Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { Requires } from '../src/auth/auth-http.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  LoginInput,
  type CreatedTokenDto,
  type LoginDto,
  type TeamsDto,
  type TokensDto,
  type UserDto,
  type UsersDto,
} from '../src/auth/identity.dto.js';
import { API_CONFIG, loadConfig } from '../src/config/env.js';
import { configureHttp } from '../src/config/http.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WIKI_STORAGE } from '../src/wiki/wiki.module.js';
import { FixtureStorage } from '../src/wiki/storage/fixture-storage.js';

@Controller('probe')
class Probe {
  @Post() @Requires('wiki.read') read() {
    return { ok: true };
  }
}
const config = loadConfig();
const database = testSchema();
const email = 'owner@example.org',
  password = 'owner test password';
let app: INestApplication | undefined, db: PrismaService, auth: AuthService, base: string;
type Headers = Record<string, string>;
let owner: Headers, ownerId: string;
function call(path: string, method = 'GET', headers: Headers = {}, body?: unknown) {
  return fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
}
async function problem(res: Response, status: number, code: string) {
  expect(res.headers.get('content-type')).toContain('application/problem+json');
  expect(await json(res, status)).toMatchObject({
    status,
    code,
    requestId: res.headers.get('x-request-id'),
  });
}
function login(address = email, pass = password) {
  return call('/auth/login', 'POST', {}, { email: address, password: pass });
}
async function signedIn(address = email, pass = password) {
  const res = await login(address, pass),
    body = await json<LoginDto>(res, 200);
  const cookie = res.headers.get('set-cookie') ?? '';
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  expect(cookie).toContain('Path=/');
  return { headers: { Cookie: cookie.split(';')[0] ?? '', 'X-CSRF-Token': body.csrfToken }, body };
}
const createUser = (address: string, roles = ['reader']) => ({
  email: address,
  name: address,
  roles,
  teamId: null,
  password: 'reader password',
});
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

beforeAll(async () => {
  database.migrate();
  const module = await Test.createTestingModule({ imports: [AppModule], controllers: [Probe] })
    .overrideProvider(API_CONFIG)
    .useValue({
      ...config,
      DATABASE_URL: database.url,
      OWNER_EMAIL: email,
      OWNER_PASSWORD: password,
    })
    .overrideProvider(WIKI_STORAGE)
    .useValue(new FixtureStorage())
    .compile();
  app = module.createNestApplication();
  db = app.get(PrismaService);
  configureHttp(app, { public: true });
  auth = app.get(AuthService);
  await Promise.all([auth.seedOwner(), auth.seedOwner()]);
  expect(await db.user.count()).toBe(1);
  expect((await db.user.findFirstOrThrow()).passwordHash).toMatch(
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
  );
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()) + '/api/v1';
  const logged = await signedIn();
  owner = logged.headers;
  ownerId = logged.body.user.id;
  expect(await db.auditEvent.count({ where: { actorId: ownerId, action: 'auth.login' } })).toBe(1);
}, 30000);
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.drop();
  }
});

it('clears missing, unknown, idle-expired and absolute-expired cookies; logout consumes the session', async () => {
  for (const cookie of ['', 'mw_session=unknown']) {
    const res = await call('/auth/session', 'GET', { Cookie: cookie });
    expect(await json(res, 200)).toEqual({ user: null, csrfToken: null });
    expect(res.headers.get('set-cookie')).toMatch(/mw_session=;/);
  }
  const logged = await signedIn();
  const { headers, body } = logged;
  expect(body.user).toEqual({
    id: ownerId,
    email,
    name: 'Owner',
    kind: 'human',
    roles: ['owner'],
    teamId: null,
  });
  expect(await json(await call('/auth/session', 'GET', headers), 200)).toEqual(body);
  const where = { tokenHash: digest(headers.Cookie.slice('mw_session='.length)) };
  expect(await db.session.findUniqueOrThrow({ where })).toMatchObject({
    csrfToken: body.csrfToken,
    userId: ownerId,
  });
  await problem(
    await call('/auth/logout', 'POST', { Cookie: headers.Cookie }),
    403,
    'CSRF_INVALID',
  );
  for (const csrf of ['', 'wrong'])
    await problem(
      await call('/auth/logout', 'POST', { Cookie: headers.Cookie, 'X-CSRF-Token': csrf }),
      403,
      'CSRF_INVALID',
    );
  expect((await call('/auth/logout', 'POST', headers)).status).toBe(204);
  await problem(await call('/auth/logout', 'POST', headers), 401, 'UNAUTHENTICATED');
  for (const data of [
    { lastSeenAt: new Date(Date.now() - 7 * 86400000) },
    { expiresAt: new Date() },
  ]) {
    const { headers: h } = await signedIn();
    await db.session.update({
      where: { tokenHash: digest(h.Cookie.slice('mw_session='.length)) },
      data,
    });
    expect(await json(await call('/auth/session', 'GET', h), 200)).toEqual({
      user: null,
      csrfToken: null,
    });
  }
}, 30000);

it('sets Secure on the session cookie in production', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  try {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/; Secure(?:;|$)/);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('reports invalid credentials uniformly and throttles a normalized email/IP pair', async () => {
  await problem(await login(email, 'wrong'), 401, 'INVALID_CREDENTIALS');
  const attempts = await Promise.all(
    Array.from({ length: 6 }, () => login('absent@example.org', 'wrong')),
  );
  expect(attempts.map((r) => r.status).sort((a, b) => a - b)).toEqual([
    401, 401, 401, 401, 401, 429,
  ]);
  for (const res of attempts)
    await problem(res, res.status, res.status === 429 ? 'RATE_LIMITED' : 'INVALID_CREDENTIALS');
  const limited = await login('ABSENT@example.org', 'wrong');
  await problem(limited, 429, 'RATE_LIMITED');
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  await problem(await login('different@example.org', 'wrong'), 401, 'INVALID_CREDENTIALS');
  // Supply a second transport peer directly; forwarded headers aren't trusted as client IPs.
  const input = Object.assign(new LoginInput(), { email: 'absent@example.org', password: 'wrong' });
  await expect(auth.login(input, '192.0.2.1', '')).rejects.toMatchObject({
    code: 'INVALID_CREDENTIALS',
  });

  const firstFailure = await db.auditEvent.findFirstOrThrow({
    where: {
      action: 'auth.login_failed',
      subjectId: digest(JSON.stringify(['absent@example.org', '127.0.0.1'])),
    },
    orderBy: { at: 'asc' },
  });
  const unlockAt = firstFailure.at.getTime() + 15 * 60_000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(unlockAt - 1);
  try {
    const stillLimited = await login('absent@example.org', 'wrong');
    await problem(stillLimited, 429, 'RATE_LIMITED');
    expect(stillLimited.headers.get('retry-after')).toBe('1');
    clock.mockReturnValue(unlockAt);
    await problem(await login('absent@example.org', 'wrong'), 401, 'INVALID_CREDENTIALS');
  } finally {
    clock.mockRestore();
  }
  expect(
    await db.auditEvent.count({ where: { action: 'auth.login_failed' } }),
  ).toBeGreaterThanOrEqual(7);
}, 30000);

it('guards admin, preserves an enabled owner, paginates and audits user changes without credentials', async () => {
  await problem(await call('/admin/users'), 401, 'UNAUTHENTICATED');
  for (const change of [{ disabled: true }, { roles: ['publisher'] }])
    await problem(await call(`/admin/users/${ownerId}`, 'PATCH', owner, change), 409, 'LAST_OWNER');
  const payload = createUser('reader@example.org');
  const user = await json<UserDto>(await call('/admin/users', 'POST', owner, payload), 201);
  expect(user).toEqual({
    id: user.id,
    email: payload.email,
    name: payload.name,
    roles: ['reader'],
    kind: 'human',
    disabled: false,
    teamId: null,
    createdAt: expect.any(String) as unknown,
  });
  const created = await db.auditEvent.findFirstOrThrow({
    where: { actorId: ownerId, action: 'user.created', subjectType: 'user', subjectId: user.id },
  });
  expect(JSON.stringify(created.data)).not.toMatch(/password|argon2/i);
  await problem(
    await call('/admin/users', 'POST', owner, { ...payload, email: payload.email.toUpperCase() }),
    409,
    'EMAIL_TAKEN',
  );
  const reader = await signedIn(payload.email, payload.password);
  await problem(await call('/admin/users', 'GET', reader.headers), 403, 'FORBIDDEN');
  const first = await json<UsersDto>(await call('/admin/users?limit=1', 'GET', owner), 200);
  expect(first.items.map((i) => i.id)).toEqual([ownerId]);
  expect(first.nextCursor).toBe(ownerId);
  const second = await json<UsersDto>(
    await call('/admin/users?limit=1&cursor=' + String(first.nextCursor), 'GET', owner),
    200,
  );
  expect(second.items.map((i) => i.id)).toEqual([user.id]);
  for (const q of ['limit=0', 'limit=101', 'cursor=bad', 'other=1'])
    await problem(await call('/admin/users?' + q, 'GET', owner), 400, 'VALIDATION_FAILED');
  const team = await json<TeamsDto['items'][number]>(
    await call('/admin/teams', 'POST', owner, { name: 'Science Team' }),
    201,
  );
  expect(team).toEqual({ id: team.id, name: 'Science Team', slug: 'science-team' });
  expect(await json(await call('/admin/teams', 'GET', owner), 200)).toEqual({
    items: [team],
    nextCursor: null,
  });
  const updated = await json<UserDto>(
    await call(`/admin/users/${user.id}`, 'PATCH', owner, {
      teamId: team.id,
      password: 'new password',
      disabled: true,
    }),
    200,
  );
  expect(updated).toMatchObject({ disabled: true, teamId: team.id });
  expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  await problem(await login(payload.email, 'new password'), 403, 'ACCOUNT_DISABLED');
  expect(
    (
      await db.auditEvent.findFirstOrThrow({
        where: { subjectId: user.id, action: 'user.updated' },
      })
    ).data,
  ).toEqual({ changedFields: ['teamId', 'disabled', 'password'] });
  expect(
    await json(await call(`/admin/users/${user.id}`, 'PATCH', owner, { disabled: false }), 200),
  ).toMatchObject({ disabled: false });
  const live = await signedIn(payload.email, 'new password');
  await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
  await problem(await call('/auth/session', 'GET', live.headers), 403, 'ACCOUNT_DISABLED');
  expect(await json(await call('/admin/reindex', 'POST', owner), 200)).toEqual({
    scanned: 0,
    changed: 0,
    durationMs: expect.any(Number) as unknown,
  });
}, 40000);

it('does not count a passwordless owner or an agent as a replacement for the last sign-in owner', async () => {
  await json(
    await call('/admin/users', 'POST', owner, {
      ...createUser('passwordless@example.org', ['owner']),
      password: undefined,
    }),
    201,
  );
  const { passwordHash } = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
  await db.user.create({
    data: {
      email: 'agent@example.org',
      name: 'Agent',
      kind: 'agent',
      roles: ['owner'],
      passwordHash,
    },
  });
  for (const change of [{ disabled: true }, { roles: ['publisher'] }])
    await problem(await call(`/admin/users/${ownerId}`, 'PATCH', owner, change), 409, 'LAST_OWNER');
});

it('validates scopes, shows a token once, enforces bearer precedence, expiry, revocation and live user state', async () => {
  const target = await json<UserDto>(
    await call('/admin/users', 'POST', owner, createUser('token@example.org')),
    201,
  );
  const payload = { userId: target.id, name: 'automation', scopes: ['read'] };
  for (const s of ['review', 'unknown'])
    await problem(
      await call('/admin/tokens', 'POST', owner, { ...payload, scopes: [s] }),
      400,
      'VALIDATION_FAILED',
    );
  for (const expiresAt of [
    '2027-02-30T00:00:00Z',
    '2026-02-29T01:30:00-08:00',
    '2028-02-29T00:00:60Z',
    '2028-02-29T00:00:00.1234Z',
    '0001-01-01 00:00:00Z',
  ])
    await problem(
      await call('/admin/tokens', 'POST', owner, { ...payload, expiresAt }),
      400,
      'VALIDATION_FAILED',
    );
  const { token, ...metadata } = await json<CreatedTokenDto>(
    await call('/admin/tokens', 'POST', owner, payload),
    201,
  );
  expect(token).toMatch(/^mwt_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
  expect(metadata).toEqual({
    ...payload,
    id: metadata.id,
    prefix: token.split('_')[1],
    createdAt: expect.any(String) as unknown,
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: null,
  });
  expect((await db.apiToken.findUniqueOrThrow({ where: { id: metadata.id } })).tokenHash).toBe(
    digest(token),
  );
  const bearer = { Authorization: 'Bearer ' + token };
  expect(await json(await call('/admin/tokens', 'GET', owner), 200)).toEqual({
    items: [metadata],
    nextCursor: null,
  });
  expect(await json(await call('/auth/session', 'GET', bearer), 200)).toMatchObject({
    user: { id: target.id },
    csrfToken: null,
  });
  expect((await call('/probe', 'POST', { Cookie: owner.Cookie ?? '', ...bearer })).status).toBe(
    201,
  );
  await problem(await call('/admin/tokens', 'GET', { ...owner, ...bearer }), 403, 'FORBIDDEN');
  await problem(
    await call('/health', 'GET', { ...owner, Authorization: 'Bearer ' + token + 'x' }),
    401,
    'UNAUTHENTICATED',
  );
  const wrong = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  await problem(
    await call('/auth/session', 'GET', { Authorization: 'Bearer ' + wrong }),
    401,
    'UNAUTHENTICATED',
  );
  await call(`/admin/users/${target.id}`, 'PATCH', owner, { disabled: true });
  await problem(await call('/auth/session', 'GET', bearer), 403, 'ACCOUNT_DISABLED');
  await call(`/admin/users/${target.id}`, 'PATCH', owner, { disabled: false });
  expect((await call('/admin/tokens/' + metadata.id, 'DELETE', owner)).status).toBe(204);
  await problem(await call('/auth/session', 'GET', bearer), 401, 'UNAUTHENTICATED');
  const expired = await json<CreatedTokenDto>(
    await call('/admin/tokens', 'POST', owner, {
      ...payload,
      expiresAt: '2000-02-29T00:30:00.1230+01:00',
    }),
    201,
  );
  expect(expired.expiresAt).toBe('2000-02-28T23:30:00.123Z');
  await problem(
    await call('/auth/session', 'GET', { Authorization: 'Bearer ' + expired.token }),
    401,
    'UNAUTHENTICATED',
  );
  const listed = await json<TokensDto>(await call('/admin/tokens?limit=1', 'GET', owner), 200);
  expect(listed.items[0]).toMatchObject({
    ...metadata,
    revokedAt: expect.any(String) as unknown,
    lastUsedAt: expect.any(String) as unknown,
  });
  expect(listed.nextCursor).toBe(metadata.id);
  const events = await db.auditEvent.findMany({
    where: { subjectId: metadata.id },
    orderBy: { at: 'asc' },
  });
  expect(events.map((e) => e.action)).toEqual(['token.created', 'token.revoked']);
  expect(JSON.stringify(events)).not.toContain(token);
}, 40000);
