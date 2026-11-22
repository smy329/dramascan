/**
 * Global test setup for Vitest integration tests.
 *
 * - Ensures the isolated test database exists.
 * - Applies migrations to the test database before the suite runs.
 * - Uses the TEST_DATABASE_URL environment variable.
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import globalTeardown from './global-teardown';

/**
 * Loads `.env.local` tolerating the encoding it is stored in.
 *
 * `dotenv/config` only reads `.env` as UTF-8. The repository's local file can
 * be UTF-16 LE (with a BOM), so `TEST_DATABASE_URL` would silently be absent.
 * Variables already present in the process environment always win.
 */
function loadLocalEnv() {
  let contents: Buffer;

  try {
    contents = readFileSync('.env.local');
  } catch {
    return;
  }

  let text: string;
  if (contents.length >= 2 && contents[0] === 0xff && contents[1] === 0xfe) {
    text = contents.subarray(2).toString('utf16le');
  } else if (contents.length >= 2 && contents[0] === 0xfe && contents[1] === 0xff) {
    const body = Buffer.from(contents.subarray(2));
    if (body.length % 2 === 0) {
      body.swap16();
    }
    text = body.toString('utf16le');
  } else {
    text = contents.toString('utf8').replace(/^\uFEFF/, '');
  }

  for (const [key, value] of Object.entries(parse(text))) {
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

/**
 * Remove the fixture users an interrupted run left behind.
 *
 * The integration and end-to-end suites share one isolated test database. A
 * crashed run leaves its fixture users behind, and an active Super Admin left
 * behind silently breaks the "last active Super Admin" guard that several
 * tests assert: the guard is global by design, so a foreign Super Admin makes
 * a legitimate deactivation look allowed.
 *
 * The cleanup is scoped to the email prefixes the suites use, so it can only
 * ever remove a row the test suites created. It runs before any test, against
 * the dedicated `_test` database that was verified above.
 */
async function removeLeftoverFixtureUsers(testDatabaseUrl: string): Promise<void> {
  const client = new Pool({ connectionString: testDatabaseUrl });

  try {
    await client.query(
      `DELETE FROM users WHERE email LIKE 'it-%' OR email LIKE 'e2e-%'`
    );
  } finally {
    await client.end();
  }
}

async function globalSetup() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests require an isolated PostgreSQL database.'
    );
  }

  const url = new URL(testDatabaseUrl);
  const databaseName = url.pathname.replace(/^\//, '');

  if (!databaseName.endsWith('_test')) {
    throw new Error(`The test database name must end with "_test" (received "${databaseName}").`);
  }

  if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error(`The test database name contains unsupported characters: "${databaseName}".`);
  }

  // Keep the credentials from TEST_DATABASE_URL; only replace the database path.
  const maintenanceUrl = new URL(testDatabaseUrl);
  maintenanceUrl.pathname = '/postgres';

  const pool = new Pool({ connectionString: maintenanceUrl.toString() });

  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);

    if (rows.length === 0) {
      await pool.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`Created test database: ${databaseName}`);
    } else {
      console.log(`Test database already exists: ${databaseName}`);
    }
  } finally {
    await pool.end();
  }

  await removeLeftoverFixtureUsers(testDatabaseUrl);
  console.log('Removed leftover test fixture users.');

  // The test database is built from the same ordered SQL migrations that
  // production applies, so a migration defect fails integration tests instead
  // of hiding behind a schema push.
  if (!existsSync('drizzle.config.ts')) {
    console.log('drizzle.config.ts not found; skipping test database migrations.');
    return globalTeardown;
  }

  execSync('npx drizzle-kit migrate', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: 'inherit',
  });

  console.log('Test database migrations applied successfully.');

  // Vitest 5 uses the function returned by globalSetup as the teardown hook.
  return globalTeardown;
}

export default globalSetup;
