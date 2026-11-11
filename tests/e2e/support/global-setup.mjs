// Playwright global setup for end-to-end tests.
//
// Runs after the web server is available and before any test executes. It
// verifies three things and stops the run when any check fails:
//
//   1. The server at the configured base URL is the DramaScan application.
//   2. The server was started by this run's E2E launcher (so its database is
//      known to be the test database), unless the operator explicitly opts in
//      to reusing a server they have already verified.
//   3. The dedicated test database is reachable and actually resolves to the
//      expected `_test` database. No migration, seed, or write is performed.

import pg from 'pg';
import {
  describeDatabaseTarget,
  E2EConfigurationError,
  resolveTestDatabase,
} from './database-target.mjs';
import { loadLocalEnv } from './load-local-env.mjs';
import { readRunMarker } from './run-marker.mjs';

loadLocalEnv();

const { Client } = pg;

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTITY_MARKERS = [
  '<title>DramaScan</title>',
  'International drama and movies, in one place.',
];

export default async function globalSetup() {
  const target = resolveTestDatabase({
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    // In the Playwright runner process DATABASE_URL is still the application's
    // main value; the web-server override applies only to the child process.
    mainDatabaseUrl: process.env.DATABASE_URL,
  });

  await verifyServerIdentity();
  verifyServerIsManagedByThisRun(target);
  await verifyTestDatabaseConnection(target);
}

async function verifyServerIdentity() {
  let response;

  try {
    response = await fetch(`${BASE_URL}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'text/html' },
    });
  } catch (error) {
    throw new E2EConfigurationError(
      `Could not reach the E2E application at ${BASE_URL}: ${
        error instanceof Error ? error.message : String(error)
      }. Start it through "npm run test:e2e", or stop whatever else owns that port.`
    );
  }

  if (!response.ok) {
    throw new E2EConfigurationError(
      `The server at ${BASE_URL} responded with HTTP ${response.status}. End-to-end tests ` +
        'refuse to run against a server that is not the DramaScan application.'
    );
  }

  const html = await response.text();
  const missingMarkers = IDENTITY_MARKERS.filter(marker => !html.includes(marker));

  if (missingMarkers.length > 0) {
    throw new E2EConfigurationError(
      `The server at ${BASE_URL} does not look like the DramaScan application. ` +
        'Stop the existing process, or start the application through "npm run test:e2e".'
    );
  }
}

function verifyServerIsManagedByThisRun(target) {
  const token = process.env.E2E_RUN_TOKEN;

  // The Playwright config always sets this token. It is absent only when the
  // setup is invoked directly for diagnostics.
  if (!token) {
    return;
  }

  const marker = readRunMarker(token);

  if (marker) {
    if (marker.databaseName !== target.databaseName) {
      throw new E2EConfigurationError(
        `The E2E launcher started the server for database "${marker.databaseName}", but the ` +
          `current TEST_DATABASE_URL points at "${target.databaseName}". Stop the server and ` +
          'run the suite again.'
      );
    }

    return;
  }

  if (process.env.E2E_ALLOW_EXISTING_SERVER === '1') {
    console.warn(
      `[e2e] WARNING: reusing the server already running at ${BASE_URL} because ` +
        'E2E_ALLOW_EXISTING_SERVER=1. Its database cannot be verified by this run; only set ' +
        'this after confirming it was started with DATABASE_URL set to TEST_DATABASE_URL.'
    );
    return;
  }

  throw new E2EConfigurationError(
    `A server is already running at ${BASE_URL}, and this run did not start it, so its ` +
      'database cannot be verified. End-to-end tests will not run against a server that might ' +
      'be using the main database. Stop that server and run "npm run test:e2e" again, or set ' +
      'E2E_ALLOW_EXISTING_SERVER=1 only after confirming it uses TEST_DATABASE_URL.'
  );
}

async function verifyTestDatabaseConnection(target) {
  const client = new Client({
    connectionString: target.url,
    application_name: 'dramascan_e2e_verify',
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });

  try {
    await client.connect();

    const result = await client.query('select current_database() as name');
    const actualName = result.rows[0]?.name;

    if (actualName !== target.databaseName) {
      throw new E2EConfigurationError(
        `Connected to database "${actualName}" but expected "${target.databaseName}". ` +
          'End-to-end tests require the dedicated test database.'
      );
    }

    console.log(`[e2e] Verified test ${describeDatabaseTarget(target)}.`);
  } catch (error) {
    if (error instanceof E2EConfigurationError) {
      throw error;
    }

    throw new E2EConfigurationError(
      `Could not verify the E2E test ${describeDatabaseTarget(target)}: ${
        error instanceof Error ? error.message : String(error)
      }. Create or start the dedicated test database before running end-to-end tests.`
    );
  } finally {
    await client.end().catch(() => {});
  }
}
