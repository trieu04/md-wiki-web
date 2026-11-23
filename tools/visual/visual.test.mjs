import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { diffPng, maskRowsFor } from './diff.mjs';
import { writeReport } from './report.mjs';
import { capturePlan } from './shoot.mjs';

function solid(width, height, rgb = 255, rect) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside =
        rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const v = inside ? 0 : rgb;
      const offset = (y * width + x) * 4;
      png.data.set([v, v, v, 255], offset);
    }
  }
  return PNG.sync.write(png);
}

test('identity yields zero and a single CSS-pixel shift of a flat element is detected', () => {
  const a = solid(20, 70, 255, { x: 4, y: 60, w: 6, h: 5 });
  const b = solid(20, 70, 255, { x: 5, y: 60, w: 6, h: 5 });
  assert.equal(diffPng(a, a, { maskRows: 56 }).percent, 0);
  const shifted = diffPng(a, b, { maskRows: 56 });
  assert.equal(shifted.mismatchPixels, 10);
  assert.equal(shifted.comparedPixels, 280);
  assert.ok(shifted.percent > 0);
  assert.equal(diffPng(solid(20, 70, 250), solid(20, 70)).mismatchPixels, 0);
});

test('excludes exactly rows 0–55 for full frames, but never masks shared components', () => {
  const a = solid(20, 70);
  const b = solid(20, 70, 255, { x: 0, y: 0, w: 20, h: 56 });
  const c = solid(20, 70, 255, { x: 0, y: 0, w: 20, h: 57 });
  assert.equal(diffPng(a, b, { maskRows: maskRowsFor('Main') }).mismatchPixels, 0);
  const boundary = diffPng(a, c, { maskRows: maskRowsFor('Page') });
  assert.equal(boundary.mismatchPixels, 20);
  const diff = PNG.sync.read(boundary.png);
  assert.equal(diff.data.readUInt32BE(55 * 20 * 4), 0);
  assert.equal(diff.data.readUInt32BE(56 * 20 * 4), 0xff0000ff);
  for (const frame of ['TopBar', 'WorkNav']) {
    assert.equal(diffPng(a, b, { maskRows: maskRowsFor(frame) }).mismatchPixels, 20 * 56);
  }
});

test('size mismatch counts only pixels present in either unmasked image', () => {
  const diff = diffPng(solid(10, 66), solid(15, 61), { maskRows: 56 });
  assert.equal(diff.comparedPixels, 125);
  assert.equal(diff.mismatchPixels, 75);
  assert.equal(diff.percent, 60);
  assert.equal(diffPng(solid(10, 56), solid(15, 56), { maskRows: 56 }).comparedPixels, 0);
});

test('capture plan uses reference viewport widths and board heights', () => {
  const config = {
    frame: 'Search',
    variant: 'recent',
    path: '/search?q=pinhole+size',
    ready: 'main',
  };
  const plan = capturePlan([config]);
  assert.deepEqual(
    plan.map(({ width, height }) => [width, height]),
    [
      [390, 1050],
      [768, 1050],
      [1024, 1050],
      [1440, 1050],
    ],
  );
  assert.throws(() => capturePlan([config, config]), /Duplicate case/);
  assert.throws(() => capturePlan([{ ...config, path: '//other.invalid' }]), /local app path/);
  assert.throws(() => capturePlan([{ ...config, frame: 'NotAFrame' }]), /Invalid frame/);
  assert.throws(() => capturePlan([{ ...config, ready: '' }]), /ready selector/);
});

test('report is self-contained and shows the exact comparison and mask', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'visual-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = solid(20, 70);
  const b = solid(20, 70, 0);
  const { index, results } = await writeReport(root, 'Test', [
    { label: '<a>', reference: a, actual: b, maskRows: 56 },
  ]);
  assert.equal(results[0].percent, 100);
  assert.equal(index, join(root, 'Test/index.html'));
  const html = await readFile(index, 'utf8');
  assert.match(html, /100\.0000% mismatch.*top 56px masked/);
  assert.match(html, /<h2>&lt;a&gt;<\/h2>/);
  for (const [name, bytes] of [
    ['reference', a],
    ['actual', b],
  ]) {
    assert.ok(html.includes(`src="image-1/${name}.png"`));
    assert.deepEqual(await readFile(join(root, `Test/image-1/${name}.png`)), bytes);
  }
  assert.ok(html.includes('src="image-1/diff.png"'));
  assert.equal(PNG.sync.read(await readFile(join(root, 'Test/image-1/diff.png'))).height, 70);
});
