/* global fetch, AbortSignal */
// Boots a throwaway stack for the Playwright reader flow (P3-08, D-53):
// built API on a fresh Postgres schema + temp copy of wiki-sample, seeded owner and reader,
// and the production web build served by `vite preview` (which proxies /api/v1 to the API).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv, env, exit } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const api = join(root, 'apps/api');
const web = join(root, 'apps/web');
const children = [];

function log(message) {
  console.log(`[e2e] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

/** Undo any read-only folder a failed blocked-flow test left behind, so cleanup can remove it. */
async function chmodTree(dir) {
  await chmod(dir, 0o755).catch(() => undefined);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) if (entry.isDirectory()) await chmodTree(join(dir, entry.name));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function start(name, command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const output = [];
  const keep = (chunk) => {
    output.push(chunk);
    if (env.E2E_VERBOSE) process.stderr.write(chunk);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  children.push({ name, child, output });
  return child;
}

async function waitFor(url, name) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const entry = children.find((c) => c.name === name);
    if (entry && entry.child.exitCode !== null) {
      throw new Error(`${name} exited early:\n${Buffer.concat(entry.output).toString()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${name} did not answer ${url} within 60 s`);
    await sleep(250);
  }
}

async function login(base, email, password) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`owner login failed: ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const { csrfToken } = await response.json();
  return { cookie, csrfToken };
}

async function seedUser(base, owner, user, name, roles) {
  const { cookie, csrfToken } = await login(base, owner.email, owner.password);
  const response = await fetch(`${base}/api/v1/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ email: user.email, name, roles, teamId: null, password: user.password }),
  });
  if (response.status !== 201) throw new Error(`seeding ${name} failed: ${response.status}`);
}

async function main() {
  const dotenv = join(root, '.env');
  const base = { ...(existsSync(dotenv) ? parseEnv(readFileSync(dotenv, 'utf8')) : {}), ...env };
  if (!base.DATABASE_URL) throw new Error('DATABASE_URL is required (.env or environment)');

  if (!env.E2E_SKIP_BUILD) {
    log('building API and web');
    run('pnpm', ['turbo', 'run', 'build', '--filter=@md-wiki/api', '--filter=@md-wiki/web'], {
      cwd: root,
    });
  }

  const schema = `e2e_${randomUUID().replaceAll('-', '')}`;
  const databaseUrl = new URL(base.DATABASE_URL);
  databaseUrl.searchParams.set('schema', schema);
  const wikiDir = await mkdtemp(join(tmpdir(), 'mw-e2e-wiki-'));
  let status = 1;
  try {
    log(`migrating throwaway schema ${schema}`);
    run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: api,
      env: { ...env, DATABASE_URL: databaseUrl.href },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    await cp(join(root, 'wiki-sample'), wikiDir, { recursive: true });

    const [apiPort, internalPort, webPort] = [await freePort(), await freePort(), await freePort()];
    const owner = { email: 'e2e-owner@example.test', password: randomBytes(12).toString('hex') };
    const reader = { email: 'e2e-reader@example.test', password: randomBytes(12).toString('hex') };
    // P5-D: a contributor proposes, the owner (the assignee, D-75) decides.
    const contributor = {
      email: 'e2e-contributor@example.test',
      password: randomBytes(12).toString('hex'),
    };
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const webUrl = `http://127.0.0.1:${webPort}`;

    log(`starting API on ${apiUrl}`);
    start('api', 'node', ['dist/main.js'], {
      cwd: api,
      env: {
        ...base,
        DATABASE_URL: databaseUrl.href,
        API_HOST: '127.0.0.1',
        API_PORT: String(apiPort),
        INTERNAL_HOST: '127.0.0.1',
        INTERNAL_PORT: String(internalPort),
        OWNER_EMAIL: owner.email,
        OWNER_PASSWORD: owner.password,
        WIKI_ROOT: wikiDir,
        WIKI_NAME: 'E2E wiki',
        NODE_ENV: 'production',
        // Production refuses the .env.example service token (D-251); the worker is not started here.
        SERVICE_TOKEN: randomBytes(24).toString('hex'),
        AUTO_PUBLISH: 'true',
      },
    });
    await waitFor(`${apiUrl}/api/v1/meta`, 'api');
    await seedUser(apiUrl, owner, reader, 'E2E Reader', ['reader']);
    await seedUser(apiUrl, owner, contributor, 'E2E Contributor', ['contributor']);

    log(`starting web preview on ${webUrl}`);
    start(
      'web',
      'pnpm',
      ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
      { cwd: web, env: { ...env, API_PORT: String(apiPort) } },
    );
    await waitFor(`${webUrl}/api/v1/meta`, 'web');

    log('running Playwright');
    const result = spawnSync(
      'pnpm',
      ['exec', 'playwright', 'test', '-c', 'e2e/playwright.config.mjs', ...argv.slice(2)],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...env,
          E2E_BASE_URL: webUrl,
          E2E_OWNER_EMAIL: owner.email,
          E2E_OWNER_PASSWORD: owner.password,
          E2E_READER_EMAIL: reader.email,
          E2E_READER_PASSWORD: reader.password,
          E2E_CONTRIBUTOR_EMAIL: contributor.email,
          E2E_CONTRIBUTOR_PASSWORD: contributor.password,
          // The blocked-publish flow makes a page folder read-only (no API fault hook exists).
          E2E_WIKI_ROOT: wikiDir,
        },
      },
    );
    status = result.status ?? 1;
  } catch (error) {
    console.error(error);
    for (const { name, output } of children) {
      if (output.length) console.error(`--- ${name} output ---\n${Buffer.concat(output)}`);
    }
  } finally {
    for (const { child } of children) if (child.exitCode === null) child.kill('SIGTERM');
    await sleep(500);
    spawnSync('pnpm', ['exec', 'prisma', 'db', 'execute', '--stdin', '--url', databaseUrl.href], {
      cwd: api,
      input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`,
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    await chmodTree(wikiDir);
    await rm(wikiDir, { recursive: true, force: true });
  }
  exit(status);
}

await main();
