import { expect, test } from '@playwright/test';

// P7-05/06: the quality check is advisory and needs no worker. Started by e2e/run.mjs, which runs
// no worker, so runs stay queued (or fail if another worker on the same Redis picks them up and
// cannot report back); every assertion accepts any non-finished state the card can show.
const owner = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };
const contributor = {
  email: process.env.E2E_CONTRIBUTOR_EMAIL,
  password: process.env.E2E_CONTRIBUTOR_PASSWORD,
};
const pending = /Quality check queued\.|Quality check running…|The last check failed/u;

async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('self-check in the editor, the quality card in review, and the owner screens', async ({
  browser,
  page,
}) => {
  const reason = 'Add a note about the quality of sample labels';
  const context = await browser.newContext();
  const author = await context.newPage();
  await signIn(author, contributor);
  await author.goto('/wiki/microscopy/sample-preparation.md/edit');
  const source = author.getByLabel('Markdown source');
  await expect(source).not.toHaveValue('');
  await source.press('ControlOrMeta+End');
  await source.pressSequentially('\n\nWrite the sample label on the slide, not the lid.\n');
  await author.getByLabel('Reason (required)').fill(reason);

  const selfCheck = author.getByRole('region', { name: 'Self-check AI' });
  await expect(selfCheck).toContainText('Advice only. It doesn’t block submitting.');
  await selfCheck.getByRole('button', { name: 'Run self-check' }).click();
  await expect(selfCheck).toContainText(pending);
  // Advice only: submitting works while the self-check has not finished.
  await expect(author.getByText('Quality check (about 2 min)')).toBeVisible();
  await author.getByRole('button', { name: 'Submit proposal' }).click();
  await expect(author).toHaveURL(/\/me\?tab=suggestions$/u);
  await context.close();

  await signIn(page, owner);
  await page.goto('/work/proposals');
  const table = page.getByRole('table', { name: 'Proposals' });
  const row = table.getByRole('row').filter({ hasText: 'microscopy/sample-preparation.md' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/Running|Check failed/u);
  await row.getByRole('link').first().click();

  const card = page.getByRole('region', { name: 'Quality check AI' });
  await expect(card).toContainText(pending);
  // The owner may ask again (`can.rerunQuality`: reviewer+ on a pending proposal).
  const rerun = page.getByRole('button', { name: 'Re-run quality check' });
  await expect(rerun).toBeVisible();
  // Review works without the worker: the decision panel is ready.
  await expect(
    page.getByRole('region', { name: 'Decision' }).getByText(/^Bound to bundle /u),
  ).toBeVisible();

  await page.goto('/work/ops');
  const jobs = page.getByRole('table', { name: 'Background jobs' });
  await expect(jobs.getByRole('row').filter({ hasText: 'quality_check' })).toHaveCount(1);
  await expect(page.getByText('Worker queue')).toBeVisible();
  await page.goto('/work/ops/jobs');
  const runs = page.getByRole('table', { name: 'AI jobs' });
  await expect(runs.getByText('Private draft').first()).toBeVisible();
  await expect(runs.getByText('On submit').first()).toBeVisible();

  await page.goto('/work/settings?tab=models');
  await expect(page.getByText('Quality check', { exact: true })).toBeVisible();
  await expect(page.getByText('rules/quality.md')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Quality rules' }).getByRole('listitem'),
  ).not.toHaveCount(0);
});
