import { expect, test } from '@playwright/test';

// P9-09…14: a reader records a source check and a report from the Trust drawer (F-04), sees them in
// You (F-05); the owner (page author by fallback) dismisses the report in Workspace › Credibility (F-12).
const reader = { email: process.env.E2E_READER_EMAIL, password: process.env.E2E_READER_PASSWORD };
const owner = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };

const path = 'microscopy/sample-preparation.md';
const anchor = 'sample-preparation';

async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/u);
}

test('a reader checks a source and reports a problem; the owner dismisses the report', async ({
  browser,
  page,
}) => {
  await signIn(page, reader);
  await page.goto(`/wiki/${path}#${anchor}`);
  const article = page.getByRole('article', { name: 'Sample Preparation' });
  const rail = page.getByRole('complementary', { name: 'About this page' });
  await expect(rail.getByRole('heading', { name: /has this label$/u })).toBeVisible();
  await expect(rail.getByText(/^Hidden until you say/u)).toBeVisible();

  // 1. I checked a source → saved, counts revealed, page followed.
  const row = article.getByRole('group', { name: /^This section:/u });
  await row.getByRole('button', { name: 'I checked a source' }).click();
  const drawer = page.getByRole('dialog');
  await expect(
    drawer.getByRole('tab', { name: 'I checked a source', selected: true }),
  ).toBeVisible();
  await drawer.getByRole('radio', { name: /Another source/u }).check();
  await drawer
    .getByLabel('Source', { exact: true })
    .fill('Pawley, Handbook of Biological Confocal Microscopy');
  await drawer.getByLabel('Where in the source').fill('ch. 2, Table 2.1');
  await drawer.getByRole('button', { name: 'Save source check' }).click();
  await expect(drawer.getByText('Source check saved')).toBeVisible();
  await expect(drawer.getByText(/1 person in 1 team checked this version/u)).toBeVisible();

  // 2. Report a problem → a section topic for the page authors.
  await drawer.getByRole('tab', { name: 'Report a problem' }).click();
  await drawer.getByRole('button', { name: 'Outdated' }).click();
  await drawer
    .getByLabel('What should it say, and how do you know?')
    .fill('The mounting medium table changed in the 2026 protocol.');
  await drawer.getByRole('button', { name: 'Send report' }).click();
  await expect(drawer.getByText(/^Report sent to/u)).toBeVisible();
  await drawer.getByRole('button', { name: 'Back to the page' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(article.getByRole('button', { name: 'Following' })).toBeVisible();

  // 3. You shows the check and the open report.
  await page.goto('/me?tab=trust');
  const activity = page.getByRole('table', { name: 'Your checks and reports' });
  await expect(activity.getByText(/^Checked a source: supports/u)).toBeVisible();
  await expect(activity.getByText(/^Reported: outdated/u)).toBeVisible();

  // 4. The owner dismisses the report with a reason in Workspace › Credibility.
  const context = await browser.newContext();
  const ownerPage = await context.newPage();
  await signIn(ownerPage, owner);
  await ownerPage.goto('/work/credibility');
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Credibility' })).toBeVisible();
  await ownerPage
    .getByRole('list', { name: 'Items' })
    .getByRole('button', { name: /Report: outdated/iu })
    .click();
  const detail = ownerPage.getByRole('region', { name: /Report: outdated/iu });
  await detail.getByText('Dismiss with a reason', { exact: true }).click();
  await detail
    .getByLabel('Reason (shown in the section’s evidence)')
    .fill('The table already matches the 2026 protocol.');
  await detail.getByRole('button', { name: 'Save decision' }).click();
  await expect(detail.getByText('The table already matches the 2026 protocol.')).toBeVisible();
  await context.close();

  // 5. The reader sees the outcome with the reason.
  await page.reload();
  await expect(
    page.getByRole('table', { name: 'Your checks and reports' }).getByText('Dismissed'),
  ).toBeVisible();
});
