import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadRuntime, publishReferences } from './render.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'design-ref-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('rejects a missing or modified canvas runtime with an actionable error', async (t) => {
  const file = join(await fixture(t), 'support.js');
  await assert.rejects(loadRuntime(file), /Cannot read design\/runtime\/support\.js \(ENOENT\)/);
  await writeFile(file, 'different bytes');
  await assert.rejects(loadRuntime(file), /support\.js SHA-256 mismatch: expected .* got /);
});

test('publishes a complete snapshot on first render and replaces it on rerender', async (t) => {
  const output = join(await fixture(t), 'reference');
  await publishReferences(output, async (stage) => {
    await writeFile(join(stage, 'old.png'), 'old image');
    await writeFile(join(stage, 'manifest.json'), 'old manifest');
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  });
  let temp;
  await publishReferences(output, async (stage) => {
    temp = stage;
    await writeFile(join(stage, 'new.png'), 'new image');
    await writeFile(join(stage, 'manifest.json'), 'new manifest');
    assert.equal(await readFile(join(output, 'manifest.json'), 'utf8'), 'old manifest');
    assert.equal(await readFile(join(output, 'old.png'), 'utf8'), 'old image');
  });
  assert.deepEqual((await readdir(output)).sort(), ['manifest.json', 'new.png']);
  assert.equal(await readFile(join(output, 'manifest.json'), 'utf8'), 'new manifest');
  assert.equal(await readFile(join(output, 'new.png'), 'utf8'), 'new image');
  await assert.rejects(lstat(temp), { code: 'ENOENT' });
});

test('discards failed captures without touching the previous snapshot', async (t) => {
  const output = join(await fixture(t), 'reference');
  await mkdir(output);
  await writeFile(join(output, 'shot.png'), 'old image');
  await writeFile(join(output, 'manifest.json'), 'old manifest');
  let temp;
  const error = new Error('capture or manifest failed');
  await assert.rejects(
    publishReferences(output, async (stage) => {
      temp = stage;
      await writeFile(join(stage, 'shot.png'), 'new image');
      throw error;
    }),
    error,
  );
  assert.equal(await readFile(join(output, 'manifest.json'), 'utf8'), 'old manifest');
  assert.equal(await readFile(join(output, 'shot.png'), 'utf8'), 'old image');
  await assert.rejects(lstat(temp), { code: 'ENOENT' });
});

test('removes the staging directory if publication fails', async (t) => {
  const output = join(await fixture(t), 'reference');
  await writeFile(output, 'not a directory');
  let temp;
  await assert.rejects(
    publishReferences(output, async (stage) => {
      temp = stage;
      await writeFile(join(stage, 'manifest.json'), 'new manifest');
    }),
    { code: 'ENOTDIR' },
  );
  assert.equal(await readFile(output, 'utf8'), 'not a directory');
  await assert.rejects(lstat(temp), { code: 'ENOENT' });
});
