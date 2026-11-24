#!/usr/bin/env node
/* global window, document */
/* eslint-disable no-console */
// Accessibility audit (P10-03): axe-core WCAG 2.1 A/AA rules on every screen of the fixture build
// (`vite build --mode visual`, MSW data), desktop and phone widths, including opened drawers and
// dialogs. Exits 1 when any violation is found. Usage: pnpm a11y [--only <substring>]
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const web = join(root, 'apps/web');
const requireFromWeb = createRequire(join(web, 'package.json'));
const axePath = createRequire(join(root, 'package.json')).resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const widths = [1440, 390];

/** Screens and states. `open` runs before the scan (opens a drawer, a dialog, a tab). */
export const cases = [
  { name: 'Home', path: '/' },
  { name: 'Search', path: '/search?q=pinhole' },
  { name: 'Page', path: '/wiki/confocal-microscopy.md#resolution' },
  {
    name: 'Page · Trust drawer (check)',
    path: '/wiki/confocal-microscopy.md#resolution',
    open: (page) => page.getByRole('button', { name: 'I checked a source' }).first().click(),
  },
  {
    name: 'Page · Trust drawer (report)',
    path: '/wiki/confocal-microscopy.md#resolution',
    open: (page) => page.getByRole('button', { name: 'Report a problem' }).first().click(),
  },
  { name: 'Page history', path: '/wiki/confocal-microscopy.md/history' },
  { name: 'Editor', path: '/wiki/confocal-microscopy.md/edit' },
  { name: 'Ask', path: '/ask' },
  { name: 'Sign in', path: '/login' },
  { name: 'You · followed', path: '/me' },
  { name: 'You · checks and reports', path: '/me?tab=trust' },
  { name: 'You · suggestions', path: '/me?tab=suggestions' },
  { name: 'Notifications', path: '/notifications' },
  { name: 'Inbox', path: '/work' },
  { name: 'Proposals', path: '/work/proposals' },
  { name: 'Review', path: '/work/proposals/fix-pinhole-units' },
  { name: 'Discussions', path: '/work/discussions' },
  { name: 'Credibility', path: '/work/credibility' },
  { name: 'Credibility · pages', path: '/work/credibility?tab=coverage' },
  { name: 'Credibility · sources', path: '/work/credibility?tab=sources' },
  { name: 'Operations', path: '/work/ops' },
  { name: 'Audit log', path: '/work/ops/audit' },
  { name: 'Jobs', path: '/work/ops/jobs' },
  ...['review', 'trust', 'people', 'agents', 'models', 'storage'].map((tab) => ({
    name: `Settings · ${tab}`,
    path: `/work/settings?tab=${tab}`,
  })),
];

/** Keyboard paths axe cannot check (run once at desktop width). Each throws on failure. */
export const keyboardChecks = [
  {
    name: 'Skip link is the first stop and moves focus to main',
    path: '/',
    run: async (page) => {
      await page.keyboard.press('Tab');
      await expectFocus(page, (el) => el.textContent === 'Skip to content');
      await page.keyboard.press('Enter');
      await expectFocus(page, (el) => el.tagName === 'MAIN');
    },
  },
  {
    name: 'Trust drawer: Enter opens it with focus on its heading, Esc closes and returns focus',
    path: '/wiki/confocal-microscopy.md#resolution',
    run: async (page) => {
      const button = page.getByRole('button', { name: 'I checked a source' }).first();
      await button.focus();
      await page.keyboard.press('Enter');
      await expectFocus(
        page,
        (el) => el.tagName === 'H2' && el.closest('[role="dialog"]') !== null,
        'after Enter',
      );
      await page.keyboard.press('Escape');
      if ((await page.getByRole('dialog').count()) !== 0)
        throw new Error('drawer still open after Esc');
      await expectFocus(page, (el) => el.textContent === 'I checked a source', 'after Esc');
    },
  },
  {
    name: 'Trust drawer tabs follow arrow keys',
    path: '/wiki/confocal-microscopy.md#resolution',
    run: async (page) => {
      await page.getByRole('button', { name: 'I checked a source' }).first().click();
      await page.getByRole('tab', { name: 'I checked a source' }).focus();
      await page.keyboard.press('ArrowRight');
      await expectFocus(
        page,
        (el) => el.getAttribute('role') === 'tab' && el.textContent?.startsWith('I used it'),
      );
    },
  },
  {
    name: 'Report form: kind buttons and the textarea are reachable with Tab',
    path: '/wiki/confocal-microscopy.md#resolution',
    run: async (page) => {
      await page.getByRole('button', { name: 'Report a problem' }).first().click();
      const dialog = page.getByRole('dialog');
      const seen = new Set();
      for (let n = 0; n < 25; n += 1) {
        await page.keyboard.press('Tab');
        const label = await page.evaluate(() => {
          const el = document.activeElement;
          return el?.closest('[role="dialog"]')
            ? (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim()
            : null;
        });
        if (label) seen.add(label);
      }
      for (const want of ['Wrong', 'Send report'])
        if (![...seen].some((label) => label.startsWith(want)))
          throw new Error(
            `"${want}" not reachable by Tab in the report form (saw ${[...seen].join(' | ')})`,
          );
      if ((await dialog.count()) !== 1) throw new Error('drawer closed while tabbing');
    },
  },
];

async function expectFocus(page, predicate, step = '') {
  const handle = await page.evaluateHandle(() => document.activeElement);
  const ok = await handle.evaluate(predicate);
  if (!ok) {
    const what = await handle.evaluate((el) => el?.outerHTML.slice(0, 120));
    throw new Error(`${step ? `${step}: ` : ''}unexpected focus: ${what}`);
  }
}

async function keyboard(browser, origin, check) {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  try {
    await page.goto(check.path);
    await page.locator('main').first().waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await check.run(page);
    return null;
  } catch (error) {
    return error.message.split('\n')[0];
  } finally {
    await context.close();
  }
}

async function withApp(run) {
  const { build, preview } = requireFromWeb('vite');
  const outDir = await mkdtemp(join(tmpdir(), 'md-wiki-a11y-'));
  try {
    const config = {
      root: web,
      mode: 'visual',
      logLevel: 'warn',
      build: { outDir, emptyOutDir: true },
    };
    await build(config);
    const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
    try {
      const browser = await chromium.launch();
      try {
        return await run(browser, `http://127.0.0.1:${server.httpServer.address().port}`);
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

async function scan(browser, origin, item, width) {
  // The app's CSP (D-251) would block the injected axe script.
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width, height: 900 },
    bypassCSP: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(item.path);
    await page.locator('main, [role="main"]').first().waitFor({ timeout: 15_000 });
    // Let fixture queries settle (MSW answers asynchronously).
    await page.waitForLoadState('networkidle');
    if (item.open) {
      await item.open(page);
      await page.waitForLoadState('networkidle');
    }
    await page.addScriptTag({ path: axePath });
    const result = await page.evaluate(
      (tags) =>
        window.axe.run(document, {
          runOnly: { type: 'tag', values: tags },
          resultTypes: ['violations'],
        }),
      TAGS,
    );
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: n.failureSummary })),
    }));
  } finally {
    await context.close();
  }
}

async function main() {
  const { values } = parseArgs({ args: argv.slice(2), options: { only: { type: 'string' } } });
  const selected = cases.filter(
    (c) => !values.only || c.name.toLowerCase().includes(values.only.toLowerCase()),
  );
  const failures = await withApp(async (browser, origin) => {
    const found = [];
    for (const item of selected)
      for (const width of widths) {
        let violations;
        try {
          violations = await scan(browser, origin, item, width);
        } catch (error) {
          violations = [
            {
              id: 'audit-error',
              impact: 'critical',
              help: error.message.split('\n')[0],
              nodes: [],
            },
          ];
        }
        console.log(`${violations.length ? '✗' : '✓'} ${item.name} @${width}`);
        for (const v of violations) {
          console.log(`    ${v.impact} ${v.id}: ${v.help}`);
          for (const n of v.nodes.slice(0, 4)) console.log(`      ${n.target}`);
          if (v.nodes.length > 4) console.log(`      … ${v.nodes.length - 4} more`);
        }
        found.push(...violations.map((v) => ({ screen: item.name, width, ...v })));
      }
    for (const check of keyboardChecks) {
      if (values.only && !check.name.toLowerCase().includes(values.only.toLowerCase())) continue;
      const problem = await keyboard(browser, origin, check);
      console.log(`${problem ? '✗' : '✓'} keyboard: ${check.name}`);
      if (problem) {
        console.log(`    ${problem}`);
        found.push({
          screen: check.name,
          width: 1440,
          id: 'keyboard',
          impact: 'serious',
          help: problem,
          nodes: [],
        });
      }
    }
    return found;
  });
  console.log(
    `\n${selected.length * widths.length} axe scans + keyboard checks, ${failures.length} violations (axe ${TAGS.join(', ')})`,
  );
  if (failures.length) exit(1);
}

if (import.meta.url === `file://${argv[1]}`) await main();
