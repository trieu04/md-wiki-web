import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  compareRestore,
  countSql,
  ensureSchemaIfMissing,
  listTree,
  parseDatabaseUrl,
  parseRows,
  pgCommand,
  shellQuote,
  tablesSql,
  validateManifest,
} from './lib.mjs';

const sha = 'a'.repeat(64);

test('parseDatabaseUrl reads the Prisma schema and strips it for libpq', () => {
  const db = parseDatabaseUrl(
    'postgresql://mdwiki:p%40ss@localhost:5432/mdwiki?schema=e2e_x&sslmode=disable',
  );
  assert.deepEqual(
    { database: db.database, user: db.user, schema: db.schema },
    { database: 'mdwiki', user: 'mdwiki', schema: 'e2e_x' },
  );
  assert.equal(db.libpqUrl, 'postgresql://mdwiki:p%40ss@localhost:5432/mdwiki?sslmode=disable');
  assert.equal(parseDatabaseUrl('postgres://u@h/db').schema, 'public');
});

test('parseDatabaseUrl rejects other protocols, a missing database and unsafe schemas', () => {
  assert.throws(() => parseDatabaseUrl('mysql://u@h/db'), /postgresql/);
  assert.throws(() => parseDatabaseUrl('postgresql://u@h/'), /no database/);
  assert.throws(() => parseDatabaseUrl('postgresql://u@h/db?schema=a;drop'), /Unsafe schema/);
  assert.throws(() => parseDatabaseUrl('postgresql://u@h/db?schema=1abc'), /Unsafe schema/);
});

test('pgCommand uses the URL locally and user/database inside a container', () => {
  const db = parseDatabaseUrl('postgresql://mdwiki:pw@localhost/mdwiki');
  assert.deepEqual(pgCommand('pg_dump', ['-Fc'], db, ''), {
    command: 'pg_dump',
    args: ['--dbname=postgresql://mdwiki:pw@localhost/mdwiki', '-Fc'],
  });
  const viaDocker = pgCommand('psql', ['-c', "SELECT 'x'"], db, 'docker compose exec -T postgres');
  assert.equal(viaDocker.command, 'sh');
  assert.equal(
    viaDocker.args[1],
    `docker compose exec -T postgres psql -U mdwiki -d mdwiki -c 'SELECT '\\''x'\\'''`,
  );
});

test('pgCommand without a connection only runs the tool', () => {
  const db = parseDatabaseUrl('postgresql://mdwiki:pw@localhost/mdwiki');
  assert.deepEqual(pgCommand('pg_restore', ['-f', '-'], db, '', { connect: false }), {
    command: 'pg_restore',
    args: ['-f', '-'],
  });
  assert.equal(
    pgCommand('pg_restore', ['-f', '-'], db, 'x exec', { connect: false }).args[1],
    'x exec pg_restore -f -',
  );
});

test('ensureSchemaIfMissing only rewrites the schema creation line', () => {
  const sql =
    'SET x = 1;\nCREATE SCHEMA public;\nCREATE TABLE public."CREATE SCHEMA public;" ();\n';
  assert.equal(
    ensureSchemaIfMissing(sql, 'public'),
    'SET x = 1;\nCREATE SCHEMA IF NOT EXISTS public;\nCREATE TABLE public."CREATE SCHEMA public;" ();\n',
  );
  assert.equal(
    ensureSchemaIfMissing('CREATE SCHEMA "e2e_x";', 'e2e_x'),
    'CREATE SCHEMA IF NOT EXISTS "e2e_x";',
  );
  assert.equal(ensureSchemaIfMissing('CREATE SCHEMA other;', 'public'), 'CREATE SCHEMA other;');
});

test('shellQuote leaves safe words and quotes the rest', () => {
  assert.equal(shellQuote('-Fc'), '-Fc');
  assert.equal(shellQuote('a b'), "'a b'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});

test('count and table SQL quote identifiers and literals', () => {
  assert.equal(countSql('public', []), null);
  assert.equal(
    countSql('s', ['User', 'a"b']),
    `SELECT 'User' AS t, count(*) FROM "s"."User" UNION ALL SELECT 'a"b' AS t, count(*) FROM "s"."a""b" ORDER BY 1;`,
  );
  assert.match(tablesSql("o'k"), /table_schema = 'o''k'/);
  assert.deepEqual(parseRows('User|3\n\n Team|0 \n'), [
    ['User', '3'],
    ['Team', '0'],
  ]);
});

const manifest = {
  format: 1,
  database: { file: 'database.dump', sha256: sha, tables: { User: 2, Team: 0 } },
  wiki: {
    file: 'wiki.tar.gz',
    sha256: sha,
    files: [
      { path: 'a.md', sha256: '1' },
      { path: '.wiki-system/r.json', sha256: '2' },
    ],
  },
};

test('compareRestore is empty when everything matches', () => {
  assert.deepEqual(
    compareRestore(manifest, {
      tables: { Team: 0, User: 2 },
      files: [
        { path: '.wiki-system/r.json', sha256: '2' },
        { path: 'a.md', sha256: '1' },
      ],
    }),
    [],
  );
});

test('compareRestore lists missing, different and unexpected tables and files', () => {
  assert.deepEqual(
    compareRestore(manifest, {
      tables: { User: 1, Extra: 0 },
      files: [
        { path: 'a.md', sha256: 'x' },
        { path: 'b.md', sha256: '3' },
      ],
    }),
    [
      'table User: 1 rows, expected 2',
      'table Team missing',
      'unexpected table Extra',
      'file a.md differs',
      'file .wiki-system/r.json missing',
      'unexpected file b.md',
    ],
  );
});

test('validateManifest rejects foreign or incomplete manifests', () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ ...manifest, format: 2 }), /format/);
  assert.throws(() => validateManifest(null), /format/);
  assert.throws(
    () => validateManifest({ ...manifest, wiki: { file: 'w', sha256: 'short' } }),
    /wiki/,
  );
});

test('listTree includes .wiki-system, sorts paths and refuses symbolic links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mw-backup-test-'));
  try {
    await mkdir(join(dir, '.wiki-system/receipts'), { recursive: true });
    await mkdir(join(dir, 'b'));
    await writeFile(join(dir, 'b/page.md'), '# B\n');
    await writeFile(join(dir, 'a.md'), '# A\n');
    await writeFile(join(dir, '.wiki-system/receipts/1.json'), '{}');
    const files = await listTree(dir);
    assert.deepEqual(
      files.map((f) => f.path),
      ['.wiki-system/receipts/1.json', 'a.md', 'b/page.md'],
    );
    assert.equal(files[1].bytes, 4);
    assert.match(files[1].sha256, /^[0-9a-f]{64}$/);
    await symlink(join(dir, 'a.md'), join(dir, 'link.md'));
    await assert.rejects(listTree(dir), /symbolic link: link.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
