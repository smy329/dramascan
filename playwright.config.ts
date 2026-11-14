import { randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { loadLocalEnv } from './tests/e2e/support/load-local-env.mjs';

// Playwright does not load Next.js environment files by itself. Load the same
// local environment the application uses so the E2E launcher and safety checks
// can see TEST_DATABASE_URL. Variables already set in the process win, so
// CI-provided values take precedence.
loadLocalEnv();

const BASE_URL = 'http://localhost:3000';

// A fresh token per run lets the global setup prove that the server it is
// talking to was started by this run's E2E launcher rather than reused from an
// unrelated `next dev` process.
const runToken = randomUUID();
process.env.E2E_RUN_TOKEN = runToken;

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mainDatabaseUrl = process.env.DATABASE_URL;
// Captured before the web-server override so the launcher can reject a test
// URL that points at the main development database.
const mainDatabaseEnv: Record<string, string> = mainDatabaseUrl
  ? { MAIN_DATABASE_URL: mainDatabaseUrl }
  : {};

export default defineConfig({
  // E2E discovery is restricted to this directory. Vitest owns tests/unit and
  // tests/integration, and Playwright must never load their `.test.ts` files.
  testDir: './tests/e2e',
  // E2E files use the `.spec.ts` suffix so a file can never be claimed by both
  // Playwright and Vitest.
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // A single worker keeps first-request route compilation from racing across
  // tests. This suite is small; determinism matters more than parallelism.
  workers: 1,
  timeout: 30_000,
  // Development servers compile routes on first request. A cold `/drama`
  // compile under load can exceed the default 5s expectation, so allow the
  // route transition to finish without masking genuine failures.
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    // Development servers compile a route the first time it is requested. A
    // cold admin route on a slow filesystem can take longer than the
    // navigation timeout even though the response itself is fast, so the
    // first request to a route is allowed to finish.
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Runs after the web server is available, so it can verify identity, the
  // test database connection, and that the server is managed by this run.
  globalSetup: './tests/e2e/support/global-setup.mjs',
  webServer: {
    command: 'node tests/e2e/support/start-server.mjs',
    url: BASE_URL,
    // Locally, Playwright may reuse a server. The global setup still refuses
    // to run against a server that this run did not launch unless the operator
    // explicitly opts in, so reuse is never silent. CI always starts its own.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // The E2E application may only ever see the dedicated test database.
      // When TEST_DATABASE_URL is absent this is intentionally blank: the
      // launcher fails before starting Next.js, and a blank value can never
      // fall back to the development database.
      DATABASE_URL: testDatabaseUrl ?? '',
      ...mainDatabaseEnv,
      E2E_BASE_URL: BASE_URL,
      E2E_RUN_TOKEN: runToken,
    },
  },
});
