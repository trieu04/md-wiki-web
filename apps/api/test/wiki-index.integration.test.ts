import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { WikiIndexer } from '../src/wiki/indexer/wiki-indexer.js';
import { captureSnapshot } from '../src/wiki/indexer/snapshots.js';
import { LocalFolderStorage } from '../src/wiki/storage/local-folder-storage.js';
import { wikiPath } from '../src/wiki/storage/wiki-storage.js';

const schema = `wiki_test_${randomUUID().replaceAll('-', '')}`;
const url = new URL(loadConfig().DATABASE_URL);
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasourceUrl: url.href });
let root: string;

beforeAll(async () => {
  // Exercise the whole migration chain, never reset a developer's schema.
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.href },
  });
  root = await fs.mkdtemp(join(tmpdir(), 'wiki-index-'));
  await fs.cp(fileURLToPath(new URL('../../../wiki-sample', import.meta.url)), root, {
    recursive: true,
  });
}, 30_000);
afterAll(async () => {
  try {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await db.$disconnect();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

it('rejects updates and deletes of audit events in Postgres', async () => {
  const event = await db.auditEvent.create({
    data: {
      actorKind: 'system',
      action: 'index',
      subjectType: 'wiki',
      subjectId: 'sample',
      data: {},
    },
  });
  await expect(
    db.$executeRaw`UPDATE "AuditEvent" SET action = 'modified' WHERE id = ${event.id}::uuid`,
  ).rejects.toThrow('AuditEvent is append-only');
  await expect(
    db.$executeRaw`DELETE FROM "AuditEvent" WHERE id = ${event.id}::uuid`,
  ).rejects.toThrow('AuditEvent is append-only');
  expect(await db.auditEvent.findUnique({ where: { id: event.id } })).toEqual(event);
});

it('indexes sample bytes, topics and searchable sections; unchanged scans dedupe and edits advance the label', async () => {
  const storage = new LocalFolderStorage(root);
  const basics = wikiPath('microscopy/basics.md');
  const original = await storage.read(basics);
  await storage.write(
    wikiPath('wiki-meta/topics.md'),
    Buffer.from('| folder | name |\n| --- | --- |\n| microscopy | Microscope Guides |\n'),
    { kind: 'create' },
    {},
  );
  const published = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
  const now = new Date('2026-11-23T10:42:00Z');
  const indexer = new WikiIndexer(storage, db, { lastPublishedSha256: published }, () => now);
  expect(await indexer.reindex()).toMatchObject({ scanned: 4, changed: 4 });
  expect(indexer.topicName('microscopy')).toBe('Microscope Guides');
  expect(indexer.topicName('lab-notes')).toBe('Lab Notes');
  const where = { path: basics.path };
  const label = '20261123-1';
  expect(await db.page.count()).toBe(4);
  expect(await db.page.findUnique({ where })).toMatchObject({
    topic: 'microscopy',
    title: 'Microscopy Basics',
    currentVersionLabel: label,
    changedOutsideReview: false,
    currentSha256: original.sha256,
    isMeta: false,
  });
  expect(await db.page.findUnique({ where: { path: 'wiki-meta/topics.md' } })).toMatchObject({
    isMeta: true,
  });
  const first = await db.snapshot.findFirstOrThrow({ where });
  expect(Buffer.from(first.content)).toEqual(original.content);
  expect(await db.pageSection.findMany({ where })).toMatchObject([
    {
      anchor: 'microscopy-basics',
      ord: 0,
      level: 1,
      versionLabel: label,
      text: original.content.toString(),
    },
  ]);
  expect(
    await db.$queryRaw`SELECT path FROM "PageSection" WHERE path = ${basics.path} AND search @@ to_tsquery('english', 'basics:A & magnification:B')`,
  ).toEqual([where]);
  expect(await indexer.reindex()).toMatchObject({ changed: 0 });
  expect(await db.$transaction((tx) => captureSnapshot(tx, original, now))).toBe(label);
  expect(await db.snapshot.count()).toBe(4);
  published.mockResolvedValue(original.sha256);
  const edit = Buffer.from('\ufeff# New Title\r\n\r\n## New Section\r\n');
  await fs.writeFile(join(root, basics.path), edit);
  expect(await indexer.reindex()).toMatchObject({ changed: 1 });
  const page = await db.page.findUniqueOrThrow({ where });
  expect(page).toMatchObject({
    currentVersionLabel: '20261123-2',
    changedOutsideReview: true,
    title: 'New Title',
  });
  expect(
    Buffer.from(
      (await db.snapshot.findFirstOrThrow({ where: { ...where, label: page.currentVersionLabel } }))
        .content,
    ),
  ).toEqual(edit);
  expect(
    await db.pageSection.findMany({
      where: { ...where, versionLabel: page.currentVersionLabel },
      orderBy: { ord: 'asc' },
    }),
  ).toMatchObject([
    { anchor: 'new-title', ord: 0 },
    { anchor: 'new-section', ord: 1 },
  ]);
  published.mockResolvedValue(page.currentSha256);
  expect(await indexer.reindex()).toMatchObject({ changed: 0 });
  expect(await db.page.findUnique({ where })).toMatchObject({ changedOutsideReview: false });
  expect(await db.snapshot.count()).toBe(5);
}, 20_000);
