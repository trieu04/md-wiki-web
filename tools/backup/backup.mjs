#!/usr/bin/env node
// md-wiki backup (P10-01): Postgres schema dump + wiki folder (incl. .wiki-system/) + manifest.
// Usage: node tools/backup/backup.mjs <out-dir>
//   env DATABASE_URL, WIKI_ROOT (from .env or the environment)
//   env MW_PG_EXEC: optional prefix to run pg_dump/psql inside the Postgres container,
//       e.g. "docker compose -f infra/docker-compose.yml exec -T postgres" (set by `make backup`).
// Stop the API first for a consistent backup; an online backup is reconciled by boot recovery.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { argv, env, exit } from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { parseEnv } from 'node:util';
import {
  DB_FILE,
  EXTENSIONS_SQL,
  FORMAT,
  MANIFEST,
  WIKI_FILE,
  listTree,
  parseDatabaseUrl,
  pgCommand,
  run,
  sha256File,
  tableCounts,
} from './lib.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

export function loadEnv() {
  const dotenv = join(root, '.env');
  return { ...(existsSync(dotenv) ? parseEnv(readFileSync(dotenv, 'utf8')) : {}), ...env };
}

export async function backup(outDir, settings) {
  const out = resolve(outDir);
  await mkdir(out, { recursive: true });
  if ((await readdir(out)).length) throw new Error(`Output folder is not empty: ${out}`);
  const db = parseDatabaseUrl(settings.DATABASE_URL);
  const wikiRoot = resolve(root, settings.WIKI_ROOT ?? '');
  if (!settings.WIKI_ROOT || !(await stat(wikiRoot)).isDirectory())
    throw new Error('WIKI_ROOT must be an existing folder');
  const exec = settings.MW_PG_EXEC;

  // 1. Database: custom-format dump of the app schema (no owner/ACL, so it restores on a clean host).
  const tables = await tableCounts(db, exec);
  // -n leaves extensions out; name them (citext) so the dump restores into a fresh database.
  const listExt = pgCommand('psql', ['-X', '-tA', '-c', EXTENSIONS_SQL], db, exec);
  const extensions = (await run(listExt.command, listExt.args))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const dump = pgCommand(
    'pg_dump',
    [
      '-Fc',
      '--no-owner',
      '--no-acl',
      '-n',
      db.schema,
      ...extensions.flatMap((name) => ['-e', name]),
    ],
    db,
    exec,
  );
  await run(dump.command, dump.args, { toFile: join(out, DB_FILE) });

  // 2. Wiki folder: every file, including .wiki-system/ (receipts, temp-free).
  const files = (await listTree(wikiRoot)).filter(
    (file) => !file.path.startsWith('.wiki-system/tmp/'),
  );
  await run('tar', [
    '-czf',
    join(out, WIKI_FILE),
    '--exclude',
    './.wiki-system/tmp',
    '-C',
    wikiRoot,
    '.',
  ]);

  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const manifest = {
    format: FORMAT,
    createdAt: new Date().toISOString(),
    app: { commit: git.status === 0 ? git.stdout.trim() : null },
    database: {
      file: DB_FILE,
      sha256: await sha256File(join(out, DB_FILE)),
      bytes: (await stat(join(out, DB_FILE))).size,
      schema: db.schema,
      extensions,
      tables,
    },
    wiki: {
      file: WIKI_FILE,
      sha256: await sha256File(join(out, WIKI_FILE)),
      bytes: (await stat(join(out, WIKI_FILE))).size,
      files,
    },
  };
  await writeFile(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

if (import.meta.url === `file://${argv[1]}`) {
  const [outDir] = argv.slice(2);
  if (!outDir) {
    console.error('usage: node tools/backup/backup.mjs <out-dir>');
    exit(2);
  }
  backup(outDir, loadEnv()).then(
    (manifest) => {
      const rows = Object.values(manifest.database.tables).reduce((a, b) => a + b, 0);
      console.log(
        `backup written to ${resolve(outDir)}: ${Object.keys(manifest.database.tables).length} tables, ${rows} rows, ${manifest.wiki.files.length} wiki files`,
      );
    },
    (error) => {
      console.error(`backup failed: ${error.message}`);
      exit(1);
    },
  );
}
