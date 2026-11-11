// E2E web-server launcher.
//
// Playwright runs this command instead of `next dev` directly. It validates
// the dedicated test database before anything starts, launches Next.js with
// DATABASE_URL forced to TEST_DATABASE_URL, and records a per-run marker so
// the global setup can confirm that the server it talks to was started here.
//
// Run `node tests/e2e/support/start-server.mjs --print-env` to validate the
// configuration and print the redacted DATABASE_URL the server would receive
// without starting the application.

import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  appTestDatabaseUrl,
  describeDatabaseTarget,
  E2EConfigurationError,
  redactConnectionString,
  resolveTestDatabase,
} from './database-target.mjs';
import { loadLocalEnv } from './load-local-env.mjs';
import { removeRunMarker, writeRunMarker } from './run-marker.mjs';

loadLocalEnv();

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const runToken = process.env.E2E_RUN_TOKEN ?? '';
const printEnvOnly = process.argv.includes('--print-env');

main();

function main() {
  let target;

  try {
    target = resolveTestDatabase({
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
      mainDatabaseUrl: process.env.MAIN_DATABASE_URL,
    });
  } catch (error) {
    fail(error);
  }

  console.log(`[e2e] Using test ${describeDatabaseTarget(target)}.`);
  console.log(`[e2e] Next.js will receive DATABASE_URL=${redactConnectionString(target.url)}.`);

  if (printEnvOnly) {
    return;
  }

  if (runToken.length > 0) {
    try {
      writeRunMarker(runToken, {
        databaseName: target.databaseName,
        baseUrl: BASE_URL,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      });
    } catch (error) {
      fail(
        new E2EConfigurationError(
          `Could not write the E2E run marker: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  const child = spawn('npm run dev', {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      // The E2E application runs on the dedicated test database. DATABASE_URL
      // is the exact validated test URL.
      DATABASE_URL: target.url,
      // The application's own configuration rejects a TEST_DATABASE_URL that is
      // byte-for-byte equal to DATABASE_URL, and the runtime never uses this
      // variable. Point it at the same test database under a distinct
      // connection name so the application's invariant holds without ever
      // referencing the main database. This also overrides any value Next.js
      // might load from .env.local.
      TEST_DATABASE_URL: appTestDatabaseUrl(target.url),
      // Assert the database target inside every server process before the
      // application code runs.
      E2E_EXPECTED_DATABASE_NAME: target.databaseName,
      NODE_OPTIONS: nodeOptionsWithPreload(),
    },
  });

  const cleanup = () => {
    if (runToken.length > 0) {
      removeRunMarker(runToken);
    }
  };

  process.on('exit', cleanup);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on('error', error => {
    console.error(`[e2e] Failed to start Next.js: ${error.message}`);
    cleanup();
    process.exit(1);
  });

  child.on('exit', code => {
    cleanup();
    process.exit(code ?? 1);
  });
}

function nodeOptionsWithPreload() {
  // NODE_OPTIONS interprets backslashes as escapes, so use forward slashes and
  // quote the path because the project directory may contain spaces.
  const preloadPath = path.resolve('tests/e2e/support/assert-server-env.cjs').replaceAll('\\', '/');
  const preloadOption = `--require "${preloadPath}"`;
  const existingOptions = process.env.NODE_OPTIONS?.trim() ?? '';

  return existingOptions.length > 0 ? `${preloadOption} ${existingOptions}` : preloadOption;
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`[e2e] ${message}`);
  process.exit(1);
}
