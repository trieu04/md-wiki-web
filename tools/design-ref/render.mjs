/* global document, window, requestAnimationFrame */
import { execFile } from 'node:child_process';
import { log } from 'node:console';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { argv, pid } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import canvas from '../../design/v4/canvas.json' with { type: 'json' };
import variants from './variants.json' with { type: 'json' };
import { clearLayoutColumns, cropPlan, layoutProbeStyle, markLayoutColumns } from './crops.mjs';
import { serve } from './serve.mjs';

const widths = [390, 768, 1024, 1440];
const timeout = 15_000;
const output = fileURLToPath(new URL('../../design/reference', import.meta.url));
const runtimeHash = 'c4929939a4fa0ff409afd395a75cd87a7a7412d26bf4cf34d7292a94c05ea482';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const captureStyle = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
`;

export async function loadRuntime(
  file = new URL('../../design/runtime/support.js', import.meta.url),
) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw new Error(
      `Cannot read design/runtime/support.js (${error.code}); restore the tracked runtime.`,
      {
        cause: error,
      },
    );
  }
  const actual = hash(bytes);
  if (actual !== runtimeHash) {
    throw new Error(
      `design/runtime/support.js SHA-256 mismatch: expected ${runtimeHash}, got ${actual}. Restore the tracked runtime.`,
    );
  }
  return bytes;
}

// Node's rename cannot atomically replace a populated directory. Use the OS exchange
// operation to make the new set visible and move the old one to the staging path in one step.
const exchangeDirectories = `
import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
src, dest = map(os.fsencode, sys.argv[1:])
if sys.platform == 'darwin':
    result = libc.renamex_np(src, dest, 2)  # RENAME_SWAP
elif sys.platform == 'linux':
    result = libc.renameat2(-100, src, -100, dest, 2)  # AT_FDCWD, RENAME_EXCHANGE
else:
    sys.exit('atomic directory exchange requires macOS or Linux')
if result != 0:
    errno = ctypes.get_errno()
    sys.exit(os.strerror(errno))
`;

export async function publishReferences(destination, build) {
  const stage = `${destination}.tmp-${pid}`;
  await mkdir(stage);
  try {
    const result = await build(stage);
    try {
      await rename(stage, destination);
    } catch (error) {
      if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
      try {
        await promisify(execFile)('python3', ['-I', '-c', exchangeDirectories, stage, destination]);
      } catch (exchangeError) {
        throw new Error(
          `Could not atomically replace ${destination}: ${exchangeError.stderr?.trim() || exchangeError.message}`,
          {
            cause: exchangeError,
          },
        );
      }
    }
    return result;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function trackNetwork(page) {
  const failures = [];
  const pending = new Set();
  let lastActivity = Date.now();
  page.on('request', (request) => {
    pending.add(request);
    lastActivity = Date.now();
  });
  function complete(request) {
    pending.delete(request);
    lastActivity = Date.now();
  }
  page.on('requestfinished', complete);
  page.on('requestfailed', (request) => {
    complete(request);
    failures.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.url()}: HTTP ${response.status()}`);
  });
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[dc')) failures.push(message.text());
  });
  return {
    check() {
      if (failures.length) throw new Error(failures.join('\n'));
    },
    async idle() {
      const deadline = Date.now() + timeout;
      // Measure idle after the variant's interactions, not just after initial navigation.
      while (pending.size || Date.now() - lastActivity < 500) {
        this.check();
        if (Date.now() >= deadline) throw new Error('Timed out waiting for network idle');
        await delay(50);
      }
      this.check();
    },
  };
}

// Phase 3 intentionally omits the deferred F-03 regions before layout. Keep
// the original shots/crops intact for Phase 9 and show History as the only action.
const pageReadingOmissions = `
  [data-sc-name="Page"] aside[aria-label="About this page"],
  [data-sc-name="Page"] article #sources,
  [data-sc-name="Page"] article sup:has(a[href="#sources"]),
  [data-sc-name="Page"] article [aria-label="Feedback on this page"],
  [data-sc-name="Page"] article > header button,
  [data-sc-name="Page"] article > header a[href="Editor.dc.html"],
  [data-sc-name="Page"] article > header a[href="Discussions.dc.html"],
  [data-sc-name="Page"] article > section > div:has(> a[href="Trust.dc.html"]) {
    display: none !important;
  }
`;
const pageReadingVariants = new Set([
  'principle',
  'overview',
  'resolution',
  'detectors',
  'history',
]);

async function shoot(context, server, stage, { frame, variant, width, height, config, crops }) {
  const page = await context.newPage();
  const network = trackNetwork(page);
  try {
    await page.setViewportSize({ width, height });
    const path = server.pages.get(`${frame}/${variant}`);
    await page.goto(`${server.origin}${path}`, { waitUntil: 'load' });
    await page.waitForFunction((name) => {
      const root = document.querySelector(`#dc-root [data-sc-name="${name}"]`);
      return root && !document.querySelector('.sc-placeholder, .sc-has-error');
    }, frame);
    await page.addStyleTag({ content: captureStyle });
    for (const [role, name, attr, value = 'true'] of config.clicks ?? []) {
      const control = page.getByRole(role, { name: new RegExp(name, 'u') });
      await control.click();
      if (attr) {
        const actual = await control.getAttribute(attr);
        if (actual !== value) throw new Error(`${name}: expected ${attr}=${value}, got ${actual}`);
      }
    }
    if (config.expect) await page.locator(config.expect).waitFor();
    // Remove click-dependent focus/scroll (including horizontal scroll in wrapped frames).
    await page.evaluate(() => {
      document.activeElement?.blur();
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0);
      }
      window.scrollTo(0, 0);
    });
    await page.mouse.move(0, 0);
    await network.idle();
    await page.evaluate(async () => {
      // Flush layout after the variant and its helmet styles have loaded, so even fonts
      // used below the fold or in form controls are requested before awaiting readiness.
      document.documentElement.getBoundingClientRect();
      await document.fonts.ready;
      if (
        ![...document.fonts].some((face) => face.family === 'Inter' && face.status === 'loaded')
      ) {
        throw new Error('Inter did not load; refusing to capture with fallback fonts');
      }
      if ([...document.fonts].some((face) => face.status === 'error'))
        throw new Error('A frame font failed to load');
    });
    await network.idle();
    await delay(1500);
    await page.evaluate(async () => {
      await document.fonts.ready;
      // Allow a paint with the final fonts before full-page capture.
      for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    });
    const png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
    network.check();
    await writeFile(join(stage, frame, `${variant}@${width}.png`), png);
    const elements = [];
    for (const { id, selector, structure } of crops) {
      try {
        // A table cell can require scrolling its own container at narrow widths.
        // Do this after capturing the untouched full frame.
        const target = page.locator(selector);
        // Each crop starts at the frame's original scroll position. An earlier
        // crop of a table cell must not scroll a later crop of the whole table.
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('*')) {
            if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0);
          }
          window.scrollTo(0, 0);
        });
        await target.scrollIntoViewIfNeeded();
        const geometry = await target.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          // Keep the raster origin and unrounded width for matching the gallery host.
          const phase = (coordinate) => coordinate - Math.floor(coordinate);
          return {
            x: phase(rect.x + window.scrollX),
            y: phase(rect.y + window.scrollY),
            width: rect.width,
            parentWidth: element.parentElement.getBoundingClientRect().width,
          };
        });
        const heights =
          structure && (await target.evaluate(markLayoutColumns, { selectors: structure }));
        const crop = await target.screenshot({
          animations: 'disabled',
          caret: 'hide',
          ...(structure && { style: layoutProbeStyle }),
        });
        if (structure) await target.evaluate(clearLayoutColumns);
        await writeFile(join(stage, 'crops', `${id}@${width}.png`), crop);
        elements.push({ id, frame, variant, width, geometry, heights, sha256: hash(crop) });
      } catch (error) {
        throw new Error(`${id} (${selector}): ${error.message}`, { cause: error });
      }
    }
    let projection;
    if (frame === 'Page' && pageReadingVariants.has(variant)) {
      await page.addStyleTag({ content: pageReadingOmissions });
      await page.evaluate(() => window.scrollTo(0, 0));
      const topBar = await page.locator('[data-sc-name="TopBar"] header').evaluate((header) => {
        const { bottom, width } = header.getBoundingClientRect();
        return { bottom: Math.round(bottom + window.scrollY), width };
      });
      const phase3 = await page.screenshot({
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      });
      const projectedVariant = `${variant}-reading`;
      await writeFile(join(stage, frame, `${projectedVariant}@${width}.png`), phase3);
      projection = { frame, variant: projectedVariant, width, topBar, sha256: hash(phase3) };
    }
    network.check();
    return { frame: { frame, variant, width, sha256: hash(png) }, projection, elements };
  } catch (error) {
    const label = `${frame}/${variant}@${width}`;
    try {
      network.check();
    } catch (networkError) {
      throw new Error(`${label}: ${networkError.message}`, { cause: error });
    }
    throw new Error(`${label}: ${error.message}`, { cause: error });
  } finally {
    await page.close();
  }
}

async function captureReferences(stage, runtime) {
  const frames = Object.fromEntries(Object.entries(variants).filter(([key]) => key !== 'crops'));
  const crops = cropPlan(variants);
  const tasks = canvas.order.flatMap((file) => {
    const frame = file.replace(/\.dc\.html$/, '');
    const entries = Object.entries(frames[frame] ?? {});
    if (!entries.length) throw new Error(`No variants configured for ${frame}`);
    return entries.flatMap(([variant, config]) => {
      const elements = crops.filter((crop) => crop.frame === frame && crop.variant === variant);
      return widths.map((width) => ({
        frame,
        variant,
        width,
        height: canvas.boards[file].h,
        config,
        crops: elements,
      }));
    });
  });
  for (const frame of Object.keys(frames)) await mkdir(join(stage, frame));
  for (const { component } of crops)
    await mkdir(join(stage, 'crops', component), { recursive: true });
  const server = await serve(frames, runtime);
  try {
    const browser = await chromium.launch({
      // Render a complete, software-rasterized frame with one raster thread, rather than
      // reusing tiles painted while fonts, interaction state, and scroll were still settling.
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
      const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'light' });
      context.setDefaultTimeout(timeout);
      const manifest = new Array(tasks.length);
      let next = 0;
      let failure;
      const workers = Array.from({ length: Math.min(cpus().length, 8) }, async () => {
        while (!failure && next < tasks.length) {
          const index = next++;
          try {
            manifest[index] = await shoot(context, server, stage, tasks[index]);
          } catch (error) {
            failure ??= error;
          }
        }
      });
      await Promise.all(workers);
      if (failure) throw failure;
      await writeFile(
        join(stage, 'manifest.json'),
        `${JSON.stringify(
          manifest.flatMap(({ frame, projection }) => (projection ? [frame, projection] : [frame])),
          null,
          2,
        )}\n`,
      );
      const elements = manifest.flatMap((entry) => entry.elements);
      if (elements.length) {
        await writeFile(
          join(stage, 'crops', 'manifest.json'),
          `${JSON.stringify(elements, null, 2)}\n`,
        );
      }
      return {
        frames: manifest.length + manifest.filter(({ projection }) => projection).length,
        crops: elements.length,
      };
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

if (argv[1] && pathToFileURL(argv[1]).href === import.meta.url) {
  const runtime = await loadRuntime();
  const count = await publishReferences(output, (stage) => captureReferences(stage, runtime));
  log(
    `Rendered ${count.frames} frame images and ${count.crops} element crops into design/reference/`,
  );
}
