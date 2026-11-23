import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { alignBelowTopBars, diffPng, maskRowsFor } from './diff.mjs';
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

test('excludes only the union of deferred rectangles and the TopBar band', () => {
  const a = solid(10, 70);
  const b = solid(10, 70, 0);
  const { png, comparedPixels, mismatchPixels } = diffPng(a, b, {
    maskRows: 56,
    maskRects: [
      { left: 2, right: 4, top: 55, bottom: 60 },
      { left: 3, right: 6, top: 57, bottom: 60 },
    ],
  });
  assert.equal(comparedPixels, 140 - (8 + 9 - 3));
  assert.equal(mismatchPixels, comparedPixels);
  const diff = PNG.sync.read(png);
  assert.equal(diff.data.readUInt32BE((58 * 10 + 5) * 4), 0);
  assert.equal(diff.data.readUInt32BE((58 * 10 + 6) * 4), 0xff0000ff);
});

test('size mismatch counts only pixels present in either unmasked image', () => {
  const diff = diffPng(solid(10, 66), solid(15, 61), { maskRows: 56 });
  assert.equal(diff.comparedPixels, 125);
  assert.equal(diff.mismatchPixels, 75);
  assert.equal(diff.percent, 60);
  assert.equal(diffPng(solid(10, 56), solid(15, 56), { maskRows: 56 }).comparedPixels, 0);
});

test('aligns by the measured top-bar edges and compares content still present below the viewport', () => {
  const reference = solid(20, 80, 246, { x: 0, y: 40, w: 20, h: 1 });
  const actual = solid(20, 80, 246, { x: 0, y: 30, w: 20, h: 1 });
  const aligned = alignBelowTopBars(reference, actual, 30, 20, 80);
  assert.ok(diffPng(reference, actual, { maskRows: 20 }).percent > 0);
  assert.equal(diffPng(...aligned).percent, 0);
  assert.equal(diffPng(...aligned).comparedPixels, 20 * 60);

  const overflowing = solid(20, 85, 246, { x: 0, y: 40, w: 20, h: 1 });
  const overflow = alignBelowTopBars(overflowing, actual, 30, 20, 75);
  assert.equal(diffPng(...overflow).mismatchPixels, 20 * 5);
  assert.throws(() => alignBelowTopBars(reference, actual, 80, 20, 80), /Invalid TopBar bottom/);
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

test('reports both the fixed-band and aligned measurements without losing the full screenshots', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'visual-aligned-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reference = solid(20, 90, 246, { x: 0, y: 70, w: 20, h: 1 });
  const actual = solid(20, 90, 246, { x: 0, y: 60, w: 20, h: 1 });
  const { index, results } = await writeReport(root, 'Test', [
    {
      label: 'Page',
      reference,
      actual,
      maskRows: 56,
      height: 90,
      referenceTopBar: { width: 19, bottom: 67 },
      actualTopBar: { width: 20, bottom: 57 },
    },
  ]);
  assert.equal(results[0].percent, 0);
  assert.ok(results[0].beforePercent > 0);
  const html = await readFile(index, 'utf8');
  assert.match(html, /reference 67px, actual 57px/);
  assert.match(html, /Fixed 56px mask before alignment:/);
  assert.deepEqual(await readFile(join(root, 'Test/image-1/actual-full.png')), actual);
});

test('reports a D-16 screen as a capture, not a comparison', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'visual-derived-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const actual = solid(20, 70);
  const { index, results } = await writeReport(root, 'Test', [{ label: 'History', actual }]);
  assert.deepEqual(results, [{ label: 'History' }]);
  assert.match(await readFile(index, 'utf8'), /no reference frame or pixel score/);
  assert.deepEqual(await readFile(join(root, 'Test/image-1/actual.png')), actual);
});
