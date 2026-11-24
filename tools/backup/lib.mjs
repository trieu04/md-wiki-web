// Backup and restore helpers (P10-01). Pure parts are unit-tested in lib.test.mjs.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const MANIFEST = 'manifest.json';
export const DB_FILE = 'database.dump';
export const WIKI_FILE = 'wiki.tar.gz';
export const FORMAT = 1;
export const EXTENSIONS_SQL =
  "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1;";

/** Database name, user and schema from a Prisma-style DATABASE_URL (`?schema=` defaults to public). */
export function parseDatabaseUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:')
    throw new Error('DATABASE_URL must be a postgresql:// URL');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL has no database name');
  const schema = url.searchParams.get('schema') || 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema))
    throw new Error(`Unsafe schema name: ${schema}`);
  // libpq does not understand Prisma's ?schema=; drop it for pg_dump/psql.
  const libpq = new URL(url.href);
  libpq.searchParams.delete('schema');
  return { database, user: decodeURIComponent(url.username), schema, libpqUrl: libpq.href };
}

/**
 * How to run pg_dump / pg_restore / psql: directly with the URL, or inside the Postgres container
 * (`MW_PG_EXEC="docker compose … exec -T postgres"`), where the local socket and the user name are used.
 */
export function pgCommand(tool, args, db, exec, { connect = true } = {}) {
  if (exec && exec.trim()) {
    const target = connect ? ['-U', db.user, '-d', db.database] : [];
    const quoted = [tool, ...target, ...args].map(shellQuote).join(' ');
    return { command: 'sh', args: ['-c', `${exec} ${quoted}`] };
  }
  return { command: tool, args: [...(connect ? [`--dbname=${db.libpqUrl}`] : []), ...args] };
}

export function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(value)
    ? value
    : `'${String(value).replaceAll("'", "'\\''")}'`;
}

/** Runs a command; stdout goes to a file (`toFile`), is fed from one (`fromFile`), or is returned. */
export function run(command, args, { toFile, fromFile, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [fromFile ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: env ?? process.env,
    });
    const out = [];
    const err = [];
    const written = toFile
      ? new Promise((done, fail) => {
          const file = createWriteStream(toFile);
          file.on('finish', done);
          file.on('error', fail);
          child.stdout.pipe(file);
        })
      : (child.stdout.on('data', (chunk) => out.push(chunk)), Promise.resolve());
    child.stderr.on('data', (chunk) => err.push(chunk));
    if (fromFile) createReadStream(fromFile).pipe(child.stdin);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0)
        reject(
          new Error(
            `${command} ${args.join(' ')} exited ${code}: ${Buffer.concat(err).toString().trim()}`,
          ),
        );
      else written.then(() => resolve(Buffer.concat(out).toString()), reject);
    });
  });
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Every regular file under `root` (including `.wiki-system/`), sorted, with its sha-256 and size. */
export async function listTree(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const bytes = (await stat(full)).size;
        files.push({
          path: relative(root, full).split(sep).join('/'),
          sha256: await sha256File(full),
          bytes,
        });
      } else if (entry.isSymbolicLink()) {
        throw new Error(`Refusing to back up a symbolic link: ${relative(root, full)}`);
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** SQL that counts every table in `schema` exactly (one row per table: name,count). */
export function countSql(schema, tables) {
  if (!tables.length) return null;
  return tables
    .map((name) => {
      const ident = `"${schema.replaceAll('"', '""')}"."${name.replaceAll('"', '""')}"`;
      return `SELECT '${name.replaceAll("'", "''")}' AS t, count(*) FROM ${ident}`;
    })
    .join(' UNION ALL ')
    .concat(' ORDER BY 1;');
}

export function tablesSql(schema) {
  return `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema.replaceAll("'", "''")}' AND table_type = 'BASE TABLE' ORDER BY 1;`;
}

export function parseRows(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|'));
}

/** Differences between what a manifest promises and what was restored; empty = verified. */
export function compareRestore(manifest, { tables, files }) {
  const problems = [];
  const want = manifest.database.tables;
  for (const [name, count] of Object.entries(want)) {
    if (!(name in tables)) problems.push(`table ${name} missing`);
    else if (tables[name] !== count)
      problems.push(`table ${name}: ${tables[name]} rows, expected ${count}`);
  }
  for (const name of Object.keys(tables))
    if (!(name in want)) problems.push(`unexpected table ${name}`);
  const restored = new Map(files.map((file) => [file.path, file.sha256]));
  for (const file of manifest.wiki.files) {
    const sha = restored.get(file.path);
    if (sha === undefined) problems.push(`file ${file.path} missing`);
    else if (sha !== file.sha256) problems.push(`file ${file.path} differs`);
    restored.delete(file.path);
  }
  for (const path of restored.keys()) problems.push(`unexpected file ${path}`);
  return problems;
}

/** Makes the dump's `CREATE SCHEMA x;` tolerate an existing (empty) schema. */
export function ensureSchemaIfMissing(sql, schema) {
  const quoted = new RegExp(`^CREATE SCHEMA (${schema}|"${schema}");$`, 'm');
  return sql.replace(quoted, 'CREATE SCHEMA IF NOT EXISTS $1;');
}

export function validateManifest(manifest) {
  if (!manifest || manifest.format !== FORMAT)
    throw new Error('Not an md-wiki backup (manifest format)');
  for (const key of ['database', 'wiki'])
    if (!manifest[key]?.file || !/^[0-9a-f]{64}$/.test(manifest[key].sha256 ?? ''))
      throw new Error(`Manifest ${key} entry is incomplete`);
  return manifest;
}

export async function readManifest(dir) {
  return validateManifest(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')));
}

export async function tableCounts(db, exec) {
  const list = pgCommand('psql', ['-X', '-tA', '-c', tablesSql(db.schema)], db, exec);
  const names = (await run(list.command, list.args))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const sql = countSql(db.schema, names);
  if (!sql) return {};
  const counts = pgCommand('psql', ['-X', '-tA', '-c', sql], db, exec);
  return Object.fromEntries(
    parseRows(await run(counts.command, counts.args)).map(([t, n]) => [t, Number(n)]),
  );
}
