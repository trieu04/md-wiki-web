#!/usr/bin/env node
/* global fetch, AbortSignal */
/* eslint-disable no-console */
// Backup/restore rehearsal (P10-01, plan.md Phase 8 exit: "restore from backup works on a clean host").
// Creates two throwaway databases on the configured server, runs the built API on the first with a copy
// of wiki-sample and writes some state through the public API, backs it up, restores into the second
// database and a new folder, boots the API there and checks it serves the same state. Drops both after.
// Usage: node tools/backup/rehearse.mjs   (env as for backup.mjs; MW_PG_EXEC when pg tools run in Docker)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, exit } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { backup, loadEnv } from './backup.mjs';
import { parseDatabaseUrl, pgCommand, run } from './lib.mjs';
import { restore } from './restore.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const api = join(root, 'apps/api');
const page = 'microscopy/sample-preparation.md';
const log = (message) => console.log(`[rehearse] ${message}`);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startApi(settings, databaseUrl, wikiRoot, owner) {
  const [port, internalPort] = [await freePort(), await freePort()];
  const output = [];
  const child = spawn('node', ['dist/main.js'], {
    cwd: api,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...settings,
      DATABASE_URL: databaseUrl,
      API_HOST: '127.0.0.1',
      API_PORT: String(port),
      INTERNAL_HOST: '127.0.0.1',
      INTERNAL_PORT: String(internalPort),
      OWNER_EMAIL: owner.email,
      OWNER_PASSWORD: owner.password,
      WIKI_ROOT: wikiRoot,
      NODE_ENV: 'production',
      // Production refuses the .env.example service token (D-251); the worker is not started here.
      SERVICE_TOKEN: randomBytes(24).toString('hex'),
      REVIEWER_AGENT_TOKEN: '',
    },
  });
  child.stdout.on('data', (chunk) => output.push(chunk));
  child.stderr.on('data', (chunk) => output.push(chunk));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`API exited early:\n${Buffer.concat(output)}`);
    try {
      if ((await fetch(`${base}/api/v1/meta`, { signal: AbortSignal.timeout(2_000) })).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('API did not start within 60 s');
    await sleep(250);
  }
  return {
    base,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((resolve) =>
        child.exitCode !== null ? resolve() : child.once('exit', resolve),
      );
    },
  };
}

async function session(base, owner) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(owner),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const { csrfToken } = await response.json();
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrfToken },
      ...(body && { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return call;
}

/** What a reader and the owner see; must be identical before and after restore. */
async function observe(call, until) {
  const encoded = encodeURIComponent(page);
  const detail = await call('GET', `/wiki/pages/${encoded}`);
  const follows = await call('GET', '/me/follows');
  const audit = await call('GET', '/audit?limit=100');
  return {
    versionLabel: detail.versionLabel,
    sha256: detail.sha256,
    pageLabel: detail.pageLabel,
    sections: detail.sections.map(({ anchor, hash, label }) => ({
      anchor,
      hash,
      label: label.label,
    })),
    follows: follows.items.map(({ path, reason }) => ({ path, reason })),
    // The observer's own sign-in on the restored copy happens after the backup; compare up to it.
    auditActions: audit.items
      .filter(({ at }) => !until || at <= until)
      .map(({ action }) => action)
      .sort(),
  };
}

async function main() {
  const settings = loadEnv();
  if (!settings.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const admin = parseDatabaseUrl(settings.DATABASE_URL);
  const exec = settings.MW_PG_EXEC;
  const suffix = randomBytes(6).toString('hex');
  const names = { src: `mwbk_src_${suffix}`, dst: `mwbk_dst_${suffix}` };
  const urlFor = (database) => {
    const url = new URL(settings.DATABASE_URL);
    url.pathname = `/${database}`;
    url.searchParams.delete('schema');
    return url.href;
  };
  const psql = (sql) => {
    const cmd = pgCommand('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], admin, exec);
    return run(cmd.command, cmd.args);
  };
  const owner = {
    email: 'rehearsal-owner@example.test',
    password: randomBytes(12).toString('hex'),
  };
  const temp = await mkdtemp(join(tmpdir(), 'mw-rehearse-'));
  const [srcWiki, dstWiki, backupDir] = ['src-wiki', 'dst-wiki', 'backup'].map((d) =>
    join(temp, d),
  );
  const created = [];
  try {
    if (!env.REHEARSE_SKIP_BUILD) {
      log('building the API');
      const built = spawnSync('pnpm', ['turbo', 'run', 'build', '--filter=@md-wiki/api'], {
        cwd: root,
        stdio: 'inherit',
      });
      if (built.status !== 0) throw new Error('API build failed');
    }
    for (const name of [names.src, names.dst]) {
      await psql(`CREATE DATABASE ${name}`);
      created.push(name);
    }
    log(`created throwaway databases ${names.src}, ${names.dst}`);
    const migrated = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: api,
      env: { ...env, DATABASE_URL: urlFor(names.src) },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (migrated.status !== 0) throw new Error('migrate deploy failed');
    await cp(join(root, 'wiki-sample'), srcWiki, { recursive: true });

    log('writing state through the API on the source');
    const source = await startApi(settings, urlFor(names.src), srcWiki, owner);
    let before;
    try {
      const call = await session(source.base, owner);
      await call('POST', '/follows', { path: page });
      const detail = await call('GET', `/wiki/pages/${encodeURIComponent(page)}`);
      await call('POST', '/page-feedback', {
        path: page,
        versionLabel: detail.versionLabel,
        answer: 'yes',
      });
      await call('POST', '/admin/teams', { name: `Rehearsal ${suffix}` });
      before = await observe(call);
    } finally {
      await source.stop();
    }

    // Publication receipts live in .wiki-system/; the sample wiki has none until something is published.
    const receipt = '.wiki-system/receipts/rehearsal/receipt.json';
    await mkdir(join(srcWiki, '.wiki-system/receipts/rehearsal'), { recursive: true });
    await writeFile(join(srcWiki, receipt), `{"rehearsal":"${suffix}"}\n`);

    log('backing up');
    const manifest = await backup(backupDir, {
      ...settings,
      DATABASE_URL: urlFor(names.src),
      WIKI_ROOT: srcWiki,
    });
    log(
      `  ${Object.keys(manifest.database.tables).length} tables, ${manifest.wiki.files.length} files`,
    );

    log('restoring onto an empty database and folder');
    await restore(backupDir, { ...settings, DATABASE_URL: urlFor(names.dst), WIKI_ROOT: dstWiki });

    if ((await readFile(join(dstWiki, receipt), 'utf8')) !== `{"rehearsal":"${suffix}"}\n`)
      throw new Error('.wiki-system receipt was not restored');
    const again = await restore(backupDir, {
      ...settings,
      DATABASE_URL: urlFor(names.dst),
      WIKI_ROOT: dstWiki,
    }).then(
      () => null,
      (error) => error.message,
    );
    if (!again?.includes('already has tables'))
      throw new Error(`restore onto a used target was not refused: ${again}`);
    log('a second restore onto the used target is refused');

    log('booting the API on the restored copy');
    const target = await startApi(settings, urlFor(names.dst), dstWiki, owner);
    let after;
    try {
      after = await observe(await session(target.base, owner), manifest.createdAt);
    } finally {
      await target.stop();
    }
    const [a, b] = [JSON.stringify(before), JSON.stringify(after)];
    if (a !== b) throw new Error(`restored state differs:\nbefore ${a}\nafter  ${b}`);
    if (!after.follows.some((f) => f.path === page)) throw new Error('follow was not restored');
    log(
      `PASS: restored API serves the same page, labels, follows and audit trail (${after.auditActions.length} audit rows)`,
    );
  } finally {
    for (const name of created)
      await psql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await rm(temp, { recursive: true, force: true });
    log('dropped throwaway databases and folders');
  }
}

main().catch((error) => {
  console.error(`[rehearse] FAIL: ${error.message}`);
  exit(1);
});
