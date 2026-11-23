import { expect, test } from '@playwright/test';

// P6-04…06: a reader asks a question on a section → a reviewer (the owner) replies → the topic is
// closed as resolved, and the reader sees the answer. Started by e2e/run.mjs.
const reader = { email: process.env.E2E_READER_EMAIL, password: process.env.E2E_READER_PASSWORD };
const owner = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };

const path = 'microscopy/sample-preparation.md';
const title = 'Which coverslip thickness?';
const question = 'Does the wet mount need a #1.5 coverslip for the 63x objective?';
const answer = 'Yes: use #1.5 (0.17 mm); the 63x objective is corrected for it.';

async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/u);
}

test('a reader asks on a section, a reviewer replies and closes the topic', async ({
  browser,
  page,
}) => {
  // 1. The reader selects a section and asks a question about it.
  await signIn(page, reader);
  await page.goto(`/wiki/${path}`);
  const contents = page.getByRole('navigation', { name: 'Pages and contents' });
  const sectionLink = contents.getByRole('link', { name: /^Sample Preparation:/u });
  await sectionLink.click();
  await expect(page).toHaveURL(/#sample-preparation$/u);
  const article = page.getByRole('article', { name: 'Sample Preparation' });
  const ask = article.getByRole('link', { name: 'Ask a question' });
  await expect(ask).toHaveAttribute(
    'href',
    `/ask?path=${encodeURIComponent(path)}&section=sample-preparation`,
  );
  await ask.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ask a question' })).toBeVisible();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue(path);
  await expect(page.getByLabel('Section', { exact: true })).toHaveValue('sample-preparation');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Post question' }).click();

  await expect(page).toHaveURL(/\/work\/discussions\?filter=mine&topic=[0-9a-f-]+$/u);
  const readerThread = page.getByRole('region', { name: 'Thread' });
  await expect(readerThread.getByRole('heading', { level: 2, name: title })).toBeVisible();
  await expect(readerThread).toContainText(`${path}#sample-preparation`);
  await expect(readerThread).toContainText(question);
  const topicUrl = page.url();

  // 2. A reviewer finds the open topic, replies, then closes it as resolved with a rationale.
  const context = await browser.newContext();
  const reviewer = await context.newPage();
  await signIn(reviewer, owner);
  await reviewer.goto('/work/discussions');
  const topics = reviewer.getByRole('region', { name: 'Topics' });
  await expect(topics.getByRole('button', { name: /^Open \d+$/u })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await topics
    .getByRole('button', { name: new RegExp(`^${title.replace('?', '\\?')}`, 'u') })
    .click();
  const thread = reviewer.getByRole('region', { name: 'Thread' });
  await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible();
  await thread.getByLabel('Reply').fill(answer);
  await thread.getByRole('button', { name: 'Post reply' }).click();
  const entries = thread.getByRole('list', { name: 'Entries' }).getByRole('listitem');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(1)).toContainText(answer);
  await expect(thread.getByText('discussion v2')).toBeVisible();

  await thread.getByLabel('Reply').fill('Answered; the page already says #1.5.');
  await thread.getByRole('button', { name: 'Resolved' }).click();
  await expect(thread.getByText('Owner · Resolved')).toBeVisible();
  await expect(thread.getByText('Answered; the page already says #1.5.').first()).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Post reply' })).toHaveCount(0);
  await context.close();

  // 3. The reader sees the answer and the closed topic.
  await page.goto(topicUrl.replace('filter=mine', 'filter=closed'));
  const list = page.getByRole('region', { name: 'Topics' });
  await expect(
    list.getByRole('button', { name: new RegExp(`^${title.replace('?', '\\?')}`, 'u') }),
  ).toContainText('Resolved');
  await expect(readerThread).toContainText(answer);
  await expect(readerThread.getByText('Owner · Resolved')).toBeVisible();
  // The asker may reopen their own topic (D-108); nobody else's controls appear.
  await expect(readerThread.getByRole('button', { name: 'Reopen' })).toBeVisible();
});
