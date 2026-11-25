import { defineConfig } from '@playwright/test';

const API_PORT = 4010; // not the dev ports (4000 / 5173), so a running dev server is never touched
const WEB_PORT = 5183;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // One shared database and a handful of stateful tests (a user is deactivated, RFQs are created):
  // run serially so the order is deterministic.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: 'chrome', // the Chrome already on the machine / CI runner — no browser download
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // the real API, pointed at RFQ_TEST by start-api.ts (which refuses any non-*_TEST database)
      command: 'npx tsx e2e/server/start-api.ts',
      cwd: '..',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev --workspace=@rfq/web -- --port ${WEB_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
