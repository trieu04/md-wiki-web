import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// P5-D: edit → submit → owner approves → auto-publish → Reviewed label; and a publish whose
// write fails → blocked → owner resolution → published. Started by e2e/run.mjs (AUTO_PUBLISH=true).
const owner = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };
const contributor = {
  email: process.env.E2E_CONTRIBUTOR_EMAIL,
  password: process.env.E2E_CONTRIBUTOR_PASSWORD,
};
const wikiRoot = process.env.E2E_WIKI_ROOT;

async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** The contributor suggests a whole-page edit and submits it; returns nothing (slug is listed). */
async function propose(browser, path, line, reason) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, contributor);
  // Contributors have no Workspace (D-95).
  await expect(page.getByRole('banner').getByRole('link', { name: /Workspace/u })).toHaveCount(0);
  await page.goto(`/wiki/${path}/edit`);
  const source = page.getByLabel('Markdown source');
  await expect(source).not.toHaveValue('');
  await source.press('ControlOrMeta+End');
  await source.pressSequentially(`\n\n${line}\n`);
  await page.getByLabel('Reason (required)').fill(reason);
  await page.getByRole('button', { name: 'Submit proposal' }).click();
  await expect(page).toHaveURL(/\/me$/u);
  await context.close();
}

async function openProposal(page, title) {
  await page.goto('/work/proposals');
  const table = page.getByRole('table', { name: 'Proposals' });
  const row = table.getByRole('row').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/work\/proposals\/[^/]+$/u);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function approve(page, reason) {
  const panel = page.getByRole('region', { name: 'Decision' });
  await expect(panel.getByText(/^Bound to bundle /u)).toBeVisible();
  await panel.getByLabel('Reason (required)').fill(reason);
  await panel.getByRole('button', { name: 'Approve and publish' }).click();
}

test('an owner approves a contribution and it is auto-published as Reviewed', async ({
  browser,
  page,
}) => {
  const reason = 'Add a note about labelling observations';
  await propose(
    browser,
    'lab-notes/image-observations.md',
    'Label every observation with the date it was made.',
    reason,
  );

  await signIn(page, owner);
  await page
    .getByRole('banner')
    .getByRole('link', { name: /Workspace/u })
    .click();
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: /Proposals/u })
    .click();
  await expect(page.getByRole('tab', { name: /^Open \d+$/u })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await openProposal(page, 'lab-notes/image-observations.md');
  await expect(page.getByRole('region', { name: 'Reason and sources' })).toContainText(reason);
  await expect(page.getByText(/Label every observation with the date/u).first()).toBeVisible();

  await approve(page, 'Checked the wording; it matches lab practice.');
  const banner = page.getByRole('status').filter({ hasText: 'Published.' });
  await expect(banner).toBeVisible();
  await expect(page.getByRole('list', { name: 'Publish progress' })).toContainText('✓ Done');

  await banner.getByRole('link', { name: 'View page' }).click();
  await expect(page).toHaveURL(/\/wiki\/lab-notes\/image-observations\.md$/u);
  await expect(page.getByText(/Label every observation with the date/u)).toBeVisible();
  await expect(page.getByRole('main').getByText('Reviewed', { exact: true }).first()).toBeVisible();

  // Home lists the published version with its summary (D-102).
  await page.goto('/#recent');
  const recent = page.getByRole('table', { name: 'Recently updated pages' });
  await expect(recent.getByRole('row').filter({ hasText: reason })).toHaveCount(1);
});

test('a failed write blocks the page until the owner records what is on disk', async ({
  browser,
  page,
}) => {
  test.skip(!wikiRoot, 'E2E_WIKI_ROOT is set by e2e/run.mjs');
  const folder = join(wikiRoot, 'microscopy');
  await propose(
    browser,
    'microscopy/basics.md',
    'Clean the objective lens before every session.',
    'Add the lens cleaning step',
  );

  await signIn(page, owner);
  await openProposal(page, 'microscopy/basics.md');
  // Forced failure: the page folder is read-only, so the write cannot be installed and its
  // outcome is read back as unknown (system-logic §7.4.5 step 8).
  await chmod(folder, 0o555);
  try {
    await approve(page, 'Lens cleaning matches the service manual.');
    const banner = page.getByRole('status').filter({ hasText: 'Publish outcome unknown.' });
    await expect(banner).toBeVisible();
  } finally {
    await chmod(folder, 0o755);
  }

  await page.getByRole('link', { name: 'Investigate in Operations' }).click();
  await expect(page).toHaveURL(/\/work\/ops$/u);
  const blocked = page.getByRole('region', { name: 'Blocked: microscopy/basics.md' });
  await expect(blocked).toContainText('Blocked: publish outcome unknown');
  await expect(blocked).toContainText(/File hash on disk \w{8} · expected new \w{8} · old \w{8}/u);
  await blocked
    .getByLabel('What you checked (required)')
    .fill('The file still has the old bytes; the folder was read-only.');
  await blocked.getByRole('button', { name: 'On disk = the old version (retry)' }).click();
  // not_written + AUTO_PUBLISH retries through the full flow and publishes (D-80, D-81).
  await expect(blocked).toHaveCount(0);

  await page.goto('/wiki/microscopy/basics.md');
  await expect(page.getByText(/Clean the objective lens before every session/u)).toBeVisible();
  await expect(page.getByRole('main').getByText('Reviewed', { exact: true }).first()).toBeVisible();
});
