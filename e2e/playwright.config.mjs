import { defineConfig, devices } from '@playwright/test';

// Started by e2e/run.mjs, which provides E2E_BASE_URL and the seeded accounts.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  outputDir: '../test-results/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
