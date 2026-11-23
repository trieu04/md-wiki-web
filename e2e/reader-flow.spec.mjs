import { expect, test } from '@playwright/test';

const reader = { email: process.env.E2E_READER_EMAIL, password: process.env.E2E_READER_PASSWORD };
const owner = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };

async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('a reader searches from Home and lands on the matching section', async ({ page }) => {
  await signIn(page, reader);
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('link', { name: 'Home' })).toBeVisible();
  // Readers have no Workspace (TopBar role "reader").
  await expect(banner.getByRole('link', { name: /Workspace/ })).toHaveCount(0);

  const box = page.getByRole('search', { name: 'Search from home' });
  await box.getByRole('searchbox', { name: 'Search the wiki' }).fill('objective');
  await box.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/search\?q=objective$/);

  const first = page.getByRole('main').locator('article').first().getByRole('link').first();
  await expect(first).toBeVisible();
  const href = await first.getAttribute('href');
  expect(href).toMatch(/^\/wiki\/.+#.+/);
  await first.click();

  const target = new URL(href, 'http://x');
  await expect(page).toHaveURL(
    (url) => url.pathname === target.pathname && url.hash === target.hash,
  );
  const anchor = decodeURIComponent(target.hash.slice(1));
  const section = page.locator(`section[id="${anchor}"]`);
  await expect(section).toBeVisible();
  await expect(section).toBeInViewport();
  await expect(section).toContainText(/objective/i);
  await expect(page.getByRole('banner').getByRole('link', { name: /Workspace/ })).toHaveCount(0);

  // The owner-only Settings route gives a reader no content.
  await page.goto('/work/settings');
  await expect(page.getByRole('alert')).toContainText('You do not have permission to do this.');
  await expect(page.getByRole('tablist', { name: 'Settings' })).toHaveCount(0);
});

test('the owner opens Settings and creates a token that works once shown', async ({
  page,
  request,
}) => {
  await signIn(page, owner);
  await page
    .getByRole('banner')
    .getByRole('link', { name: /Workspace/ })
    .click();
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL(/\/work\/settings/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'People' })).toContainText('E2E Reader');

  await page.getByRole('tab', { name: 'Agents and tokens' }).click();
  await expect(page).toHaveURL(/tab=agents/);
  const form = page.getByRole('form', { name: 'Create a token' });
  await form.getByLabel('What it is for').fill('e2e token');
  await form.getByLabel('Account').selectOption({ label: `Owner (${owner.email})` });
  await form.getByRole('checkbox', { name: 'read' }).check();
  await form.getByRole('button', { name: 'Create token' }).click();

  const created = form.getByRole('status');
  await expect(created).toContainText('Token created');
  const token = (await created.locator('[data-token]').innerText()).trim();
  expect(token).toMatch(/^mwt_/);
  // The new token is listed (without its secret) and authenticates API calls.
  await expect(page.getByText('e2e token', { exact: true })).toBeVisible();
  const tree = await request.get('/api/v1/wiki/tree', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(tree.status()).toBe(200);

  // Shown once: gone after a reload.
  await page.reload();
  await expect(page.getByText(token)).toHaveCount(0);
});
