/* global document, window, requestAnimationFrame, fetch */
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { argv } from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { chromium } from 'playwright';
import canvas from '../../design/v4/canvas.json' with { type: 'json' };
import { diffPng, maskRowsFor } from './diff.mjs';
import { writeReport } from './report.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const web = join(root, 'apps/web');
const references = join(root, 'design/reference');
const widths = [390, 768, 1024, 1440];
const captureStyle = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
`;

async function readReference(manifest, frame, variant, width) {
  const entry = manifest.find(
    (m) => m.frame === frame && m.variant === variant && m.width === width,
  );
  const name = `${frame}/${variant}@${width}`;
  if (!entry) throw new Error(`No reference for ${name}; run pnpm design:shots`);
  const png = await readFile(join(references, `${name}.png`));
  if (createHash('sha256').update(png).digest('hex') !== entry.sha256) {
    throw new Error(`Reference checksum mismatch for ${name}; run pnpm design:shots`);
  }
  return png;
}

export function capturePlan(cases) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('Expected a nonempty case array');
  const seen = new Set();
  return cases.flatMap(({ frame, variant, path, ready, prepare }) => {
    const board = canvas.boards[`${frame}.dc.html`];
    if (!board || typeof variant !== 'string' || !/^[a-z0-9-]+$/.test(variant)) {
      throw new Error(`Invalid frame/variant: ${frame}/${variant}`);
    }
    const name = `${frame}/${variant}`;
    if (seen.has(name)) throw new Error(`Duplicate case: ${name}`);
    seen.add(name);
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\')
    ) {
      throw new Error(`${name}: path must be a local app path`);
    }
    if (
      typeof ready !== 'string' ||
      !ready.trim() ||
      (prepare != null && typeof prepare !== 'function')
    ) {
      throw new Error(`${name}: expected a ready selector and optional prepare callback`);
    }
    return widths.map((width) => ({
      frame,
      variant,
      path,
      ready,
      prepare,
      width,
      height: board.h,
    }));
  });
}

async function withApp(run) {
  // Use the web workspace's Vite directly, so the dynamically bound preview
  // socket and its shutdown are owned by this process (no orphan pnpm child).
  const { build, preview } = createRequire(join(web, 'package.json'))('vite');
  const outDir = await mkdtemp(join(tmpdir(), 'md-wiki-visual-'));
  try {
    const config = { root: web, mode: 'visual', build: { outDir, emptyOutDir: true } };
    await build(config);
    const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
    try {
      const { port } = server.httpServer.address();
      const browser = await chromium.launch({
        // Match tools/design-ref/render.mjs's Chromium raster settings.
        args: [
          '--disable-gpu',
          '--disable-lcd-text',
          '--disable-font-subpixel-positioning',
          '--disable-partial-raster',
          '--num-raster-threads=1',
          '--run-all-compositor-stages-before-draw',
        ],
      });
      try {
        return await run(browser, `http://127.0.0.1:${port}`);
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

async function capture(browser, origin, { path, ready, prepare, width, height }) {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(message.text());
    });
    try {
      const response = await page.goto(path, { waitUntil: 'load' });
      if (!response?.ok() || new URL(page.url()).origin !== origin) {
        throw new Error(`Failed to load local preview path ${path} (HTTP ${response?.status()})`);
      }
      await page.locator('html[data-mw-fixtures-ready="true"]').waitFor({ state: 'attached' });
      await page.addStyleTag({ content: captureStyle });
      await prepare?.(page, { width, height });
      await page.locator(ready).waitFor({ state: 'visible' });
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        document.activeElement?.blur();
        for (const element of document.querySelectorAll('*')) {
          if (element.scrollLeft || element.scrollTop) element.scrollTo(0, 0);
        }
        window.scrollTo(0, 0);
        document.documentElement.getBoundingClientRect();
        await document.fonts.ready;
        if ([...document.fonts].some((face) => face.status === 'error')) {
          throw new Error('An app font failed to load');
        }
        for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
      });
      const png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
      if (failures.length) throw new Error(failures.join('\n'));
      return png;
    } catch (error) {
      if (failures.length) throw new Error(failures.join('\n'), { cause: error });
      throw error;
    }
  } finally {
    await context.close();
  }
}

async function runCases(cases, manifest) {
  const plan = capturePlan(cases);
  const entries = await Promise.all(
    plan.map(async (entry) => ({
      ...entry,
      label: `${entry.frame}/${entry.variant}@${entry.width}`,
      reference: await readReference(manifest, entry.frame, entry.variant, entry.width),
    })),
  );
  return withApp(async (browser, origin) => {
    const images = [];
    for (const entry of entries) {
      try {
        images.push({
          ...entry,
          actual: await capture(browser, origin, entry),
          maskRows: maskRowsFor(entry.frame),
        });
      } catch (error) {
        throw new Error(`${entry.label}: ${error.message}`, { cause: error });
      }
    }
    return images;
  });
}

async function selfTest(manifest) {
  const reference = await readReference(manifest, 'Search', 'recent', 390);
  const maskRows = maskRowsFor('Search');
  assert.equal(diffPng(reference, reference, { maskRows }).percent, 0);
  return withApp(async (browser, origin) => {
    async function shootShifted(shift) {
      return capture(browser, origin, {
        path: '/',
        width: 390,
        height: 300,
        ready: '#visual-test-element',
        async prepare(page) {
          const sample = await page.evaluate(async () => {
            const response = await fetch('/__visual/fixtures/Search');
            if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
            return response.json();
          });
          assert.equal(sample.total, 35);
          assert.equal(sample.pageCount, 14);
          assert.equal(sample.items.length, 5);
          assert.equal(sample.facets.labels.checked, 12);
          assert.equal(
            sample.items[0].snippet[0].before,
            'Emitted fluorescence returns to a point detector. Closing the ',
          );
          await page.evaluate((offset) => {
            // Standalone probe (not a product frame): move only this element.
            const scroller = document.createElement('div');
            scroller.style.cssText =
              'position: absolute; left: 0; top: 64px; width: 96px; height: 80px; overflow: hidden;';
            const content = document.createElement('div');
            content.style.cssText = 'position: relative; width: 192px; height: 160px;';
            const element = document.createElement('div');
            element.id = 'visual-test-element';
            element.style.cssText = `position: absolute; left: ${20 + offset}px; top: 16px; width: 32px; height: 20px; background: black;`;
            content.append(element);
            scroller.append(content);
            document.body.append(scroller);
            // The pixel assertion also fails if capture does not reset nested scroll.
            if (offset) {
              scroller.scrollTo(8, 8);
              if (scroller.scrollLeft !== 8 || scroller.scrollTop !== 8) {
                throw new Error('Probe failed to scroll the nested container');
              }
            }
          }, shift);
        },
      });
    }
    const baseline = await shootShifted(0);
    const shifted = await shootShifted(1);
    assert.equal(diffPng(baseline, shifted, { maskRows }).mismatchPixels, 40);
    return [
      { label: 'Search/recent@390 · reference vs itself', reference, actual: reference, maskRows },
      {
        label: 'Vite + MSW probe · element shifted 1px',
        reference: baseline,
        actual: shifted,
        maskRows,
      },
    ];
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      config: { type: 'string' },
      'self-test': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || (!values.config && !values.task && !values['self-test'])) {
    log(
      'Usage: pnpm visual:shots --task <ID> --config <cases.mjs> | pnpm visual:shots --self-test',
    );
    log(
      'A config default-exports [{ frame, variant, path, ready, prepare? }]; see tools/visual/README.md.',
    );
    return;
  }
  if (values['self-test'] ? values.config : !values.task || !values.config) {
    throw new Error('Supply --task and --config, or use --self-test without --config');
  }
  const task = values.task ?? 'P0-09';
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(task)) throw new Error(`Invalid task ID: ${task}`);
  const manifest = JSON.parse(await readFile(join(references, 'manifest.json'), 'utf8'));
  const images = values['self-test']
    ? await selfTest(manifest)
    : await runCases((await import(pathToFileURL(resolve(values.config)).href)).default, manifest);
  const { index } = await writeReport(join(root, 'visual/report'), task, images);
  log(`Wrote ${images.length} comparisons to ${index}`);
}

if (argv[1] && pathToFileURL(resolve(argv[1])).href === import.meta.url) await main();
