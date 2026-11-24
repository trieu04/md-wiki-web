#!/usr/bin/env node
// md-wiki restore (P10-01) onto a clean host: empty schema + empty/missing wiki folder.
// Usage: node tools/backup/restore.mjs <backup-dir>
//   env DATABASE_URL (target; its schema must be empty or absent), WIKI_ROOT (target; empty or absent)
//   env MW_PG_EXEC: as for backup.mjs.
// Verifies the archive hashes before touching anything, then every table's row count and every
// wiki file's sha-256 after restoring. Start the API afterwards: boot recovery reconciles publications.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { loadEnv } from './backup.mjs';
import {
  compareRestore,
  ensureSchemaIfMissing,
  listTree,
  parseDatabaseUrl,
  pgCommand,
  readManifest,
  run,
  sha256File,
  tableCounts,
} from './lib.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function emptyOrMissing(dir) {
  try {
    if (!(await stat(dir)).isDirectory()) return false;
    return (await readdir(dir)).length === 0;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

export async function restore(backupDir, settings) {
  const from = resolve(backupDir);
  const manifest = await readManifest(from);
  for (const key of ['database', 'wiki']) {
    const sha = await sha256File(join(from, manifest[key].file));
    if (sha !== manifest[key].sha256)
      throw new Error(`${manifest[key].file} does not match the manifest`);
  }
  const db = parseDatabaseUrl(settings.DATABASE_URL);
  if (db.schema !== manifest.database.schema)
    throw new Error(
      `The backup holds schema "${manifest.database.schema}"; set DATABASE_URL ?schema=${manifest.database.schema}`,
    );
  const exec = settings.MW_PG_EXEC;
  const existing = await tableCounts(db, exec);
  if (Object.keys(existing).length)
    throw new Error(`Target schema "${db.schema}" already has tables; restore needs an empty one`);
  const wikiRoot = resolve(root, settings.WIKI_ROOT ?? '');
  if (!settings.WIKI_ROOT || !(await emptyOrMissing(wikiRoot)))
    throw new Error('WIKI_ROOT must be an empty or missing folder');

  // pg_restore renders the dump as SQL; a fresh database already has `public` (pg 15+ dumps
  // `CREATE SCHEMA public`), so the schema is created only if missing, then psql applies it in one transaction.
  const work = await mkdtemp(join(tmpdir(), 'mw-restore-'));
  try {
    const sql = join(work, 'restore.sql');
    // Without a database pg_restore writes the SQL to stdout.
    const render = pgCommand('pg_restore', ['--no-owner', '--no-acl', '-f', '-'], db, exec, {
      connect: false,
    });
    await run(render.command, render.args, {
      fromFile: join(from, manifest.database.file),
      toFile: sql,
    });
    await writeFile(sql, ensureSchemaIfMissing(await readFile(sql, 'utf8'), db.schema));
    const apply = pgCommand(
      'psql',
      ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
      db,
      exec,
    );
    await run(apply.command, apply.args, { fromFile: sql });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  await mkdir(wikiRoot, { recursive: true });
  await run('tar', ['-xzf', join(from, manifest.wiki.file), '-C', wikiRoot]);

  const problems = compareRestore(manifest, {
    tables: await tableCounts(db, exec),
    files: await listTree(wikiRoot),
  });
  if (problems.length) throw new Error(`restore verification failed:\n  ${problems.join('\n  ')}`);
  return manifest;
}

if (import.meta.url === `file://${argv[1]}`) {
  const [backupDir] = argv.slice(2);
  if (!backupDir) {
    console.error('usage: node tools/backup/restore.mjs <backup-dir>');
    exit(2);
  }
  restore(backupDir, loadEnv()).then(
    (manifest) =>
      console.log(
        `restored and verified: ${Object.keys(manifest.database.tables).length} tables, ${manifest.wiki.files.length} wiki files (backup of ${manifest.createdAt})`,
      ),
    (error) => {
      console.error(`restore failed: ${error.message}`);
      exit(1);
    },
  );
}
