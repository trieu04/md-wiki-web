import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalFolderStorage } from '../src/wiki/storage/local-folder-storage.js';
import { FixtureStorage, type StorageFault } from '../src/wiki/storage/fixture-storage.js';
import { wikiPath, sha256 } from '../src/wiki/storage/wiki-storage.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof fs>();
  return { ...real, open: vi.fn(real.open), rename: vi.fn(real.rename) };
});
const a = wikiPath('guide/a.md');
const create = { kind: 'create' } as const;
const first = Buffer.from('# First\r\n');
const second = Buffer.from('# Second');
let dir: string;
let root: string;
let local: LocalFolderStorage;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'wiki-storage-'));
  root = join(dir, 'wiki');
  local = new LocalFolderStorage(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.rename).mockReset();
  await fs.rm(dir, { recursive: true, force: true });
});

it('persists exact bytes and a durable receipt; syncs temp before rename, parent and receipt afterwards', async () => {
  const ops: string[] = [];
  const real = await vi.importActual<typeof fs>('node:fs/promises');
  vi.mocked(fs.open).mockImplementation(async (path, ...args) => {
    const handle = await real.open(path, ...args);
    const sync = handle.sync.bind(handle);
    vi.spyOn(handle, 'sync').mockImplementation(async () => {
      await sync();
      ops.push(String(path));
    });
    return handle;
  });
  vi.mocked(fs.rename).mockImplementation(async (from, to) => {
    await real.rename(from, to);
    ops.push('renamed');
  });
  const meta = { actor: 'example' };
  const receipt = await local.write(a, first, create, meta);
  expect(receipt).toMatchObject({ beforeSha256: null, afterSha256: sha256(first), path: a });
  expect(receipt.receiptPath).toMatch(/^\.wiki-system\/receipts\/\d{8}\/[\da-f-]+\.json$/);
  expect(JSON.parse(await fs.readFile(join(root, receipt.receiptPath), 'utf8'))).toMatchObject({
    ...receipt,
    writtenAt: receipt.writtenAt.toISOString(),
    meta,
  });
  const rename = ops.indexOf('renamed');
  expect(ops[rename - 1]).toMatch(/\.wiki-system\/tmp\/[^/]+$/);
  expect(ops[rename + 1]).toMatch(/\/guide$/);
  expect(ops.slice(rename + 2).some((path) => path.endsWith(receipt.receiptPath))).toBe(true);
  expect((await new LocalFolderStorage(root).read(a)).content).toEqual(first);
});
it('lists only portable markdown, sorted, with prefix, metadata and no internal files', async () => {
  await local.write(a, first, create, {});
  const b = wikiPath('b.md');
  await local.write(b, second, create, {});
  await fs.mkdir(join(root, 'contributions'));
  await fs.writeFile(join(root, 'contributions/XX123.contribution.md'), 'incoming');
  await fs.writeFile(join(root, '.wiki-system/internal.md'), 'internal');
  expect((await local.list()).map((item) => item.path)).toEqual([b, a]);
  expect(await local.list('guide/')).toEqual([
    { path: a, mtime: (await local.read(a)).mtime, size: first.length, sha256: sha256(first) },
  ]);
});
it('preserves the target on create conflict and stale/missing replace precondition', async () => {
  const replace = { kind: 'replace', expectedSha256: sha256(first) } as const;
  await expect(local.read(a)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(local.write(a, first, replace, {})).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  await local.write(a, first, create, {});
  await expect(local.write(a, second, create, {})).rejects.toMatchObject({
    code: 'ALREADY_EXISTS',
  });
  expect(await local.write(a, second, replace, {})).toMatchObject({
    beforeSha256: sha256(first),
    afterSha256: sha256(second),
  });
  await fs.writeFile(join(root, a.path), 'external');
  await expect(
    local.write(a, first, { ...replace, expectedSha256: sha256(second) }, {}),
  ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect((await local.read(a)).content.toString()).toBe('external');
});
it('serialises competing conditional writes across adapters for the same root', async () => {
  const other = new LocalFolderStorage(root);
  const results = await Promise.allSettled([
    local.withRootLock(() => local.write(a, first, create, {})),
    other.write(a, second, create, {}),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'ALREADY_EXISTS' },
  });
});
it('rejects symlink traversal for reads, listing and writes (including a missing descendant)', async () => {
  await fs.mkdir(root);
  await fs.mkdir(join(dir, 'outside'));
  await fs.writeFile(join(dir, 'outside/a.md'), first);
  await fs.symlink(join(dir, 'outside'), join(root, 'guide'));
  const error = { code: 'INVALID_PATH', detail: 'TRAVERSAL' };
  await expect(local.read(a)).rejects.toMatchObject(error);
  await expect(local.list()).rejects.toMatchObject(error);
  await expect(
    local.write(wikiPath('guide/nested/missing.md'), second, create, {}),
  ).rejects.toMatchObject(error);
  await expect(
    local.write(a, second, { kind: 'replace', expectedSha256: sha256(first) }, {}),
  ).rejects.toMatchObject(error);
  expect(await fs.readdir(join(dir, 'outside'))).toEqual(['a.md']);
  expect(await fs.readFile(join(dir, 'outside/a.md'))).toEqual(first);
});
it('rejects a symlink in the internal temp path', async () => {
  await fs.mkdir(join(root, '.wiki-system'), { recursive: true });
  await fs.symlink(dir, join(root, '.wiki-system/tmp'));
  await expect(local.write(a, first, create, {})).rejects.toMatchObject({ detail: 'TRAVERSAL' });
  await expect(local.read(a)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('rejects invalid UTF-8, including bytes introduced outside the adapter', async () => {
  const invalid = Buffer.from([0xff]);
  for (const storage of [local, new FixtureStorage()])
    await expect(storage.write(a, invalid, create, {})).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
  await fs.mkdir(join(root, 'guide'), { recursive: true });
  await fs.writeFile(join(root, a.path), invalid);
  await expect(local.read(a)).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
  await expect(local.list()).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
});
it.each(['local', 'fixture'] as const)(
  '%s checks write conditions against the bytes of an invalid UTF-8 target',
  async (adapter) => {
    const invalid = Buffer.from([0xff]);
    class ExternalEditFixture extends FixtureStorage {
      editOutsideStorage() {
        return this.install(a, invalid);
      }
    }
    const fixture = new ExternalEditFixture();
    const storage = adapter === 'local' ? local : fixture;
    await storage.write(a, first, create, {});
    if (adapter === 'local') await fs.writeFile(join(root, a.path), invalid);
    else await fixture.editOutsideStorage();

    await expect(storage.write(a, second, create, {})).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    await expect(
      storage.write(a, second, { kind: 'replace', expectedSha256: sha256(first) }, {}),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const matching = { kind: 'replace', expectedSha256: sha256(invalid) } as const;
    expect(await storage.write(a, second, matching, {})).toMatchObject({
      beforeSha256: sha256(invalid),
      afterSha256: sha256(second),
    });
  },
);
it('verifies actual bytes after rename, emitting no receipt on mismatch', async () => {
  const real = await vi.importActual<typeof fs>('node:fs/promises');
  vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => {
    await real.rename(from, to);
    await fs.writeFile(to, second);
  });
  await expect(local.write(a, first, create, {})).rejects.toMatchObject({ code: 'VERIFY_FAILED' });
  expect((await local.read(a)).content).toEqual(second);
  expect(await fs.readdir(join(root, '.wiki-system'))).toEqual(['tmp']);
  expect(await fs.readdir(join(root, '.wiki-system/tmp'))).toEqual([]);
});
it.each<StorageFault>(['beforeRename', 'afterRename', 'beforeVerify', 'receipt'])(
  'injects %s only once, preserving the specified state',
  async (fault) => {
    const storage = new FixtureStorage();
    await storage.write(a, first, create, {});
    storage.fault = fault;
    await expect(
      storage.write(a, second, { kind: 'replace', expectedSha256: sha256(first) }, {}),
    ).rejects.toMatchObject({ code: fault === 'beforeVerify' ? 'VERIFY_FAILED' : 'STORAGE_ERROR' });
    const expected = fault === 'beforeRename' ? first : second;
    expect((await storage.read(a)).content).toEqual(expected);
    expect(storage.receipts.size).toBe(1);
    await storage.write(a, first, { kind: 'replace', expectedSha256: sha256(expected) }, {});
    expect(storage.receipts.size).toBe(2);
    expect(await storage.list('guide/')).toMatchObject([{ path: a, sha256: sha256(first) }]);
  },
);
