import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { verifyPassword } from 'better-auth/crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests for `scripts/seed-super-admin.mjs`.
 *
 * The script is spawned as a child process, exactly as an operator runs it,
 * against the isolated `_test` database. It must be idempotent, must store a
 * verifiable hash instead of the plaintext password, and must never write a
 * credential for invalid input.
 */

const execFileAsync = promisify(execFile);

const TEST_EMAIL = 'it-seed-super-admin@example.com';
const SCRIPT = 'scripts/seed-super-admin.mjs';

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for seed integration tests.');
  }

  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error('Refusing to run seed integration tests against a non-test database.');
  }
  if (url === process.env.MAIN_DATABASE_URL) {
    throw new Error('Refusing to run seed integration tests against the main database.');
  }

  return url;
}

async function runSeed(overrides: Record<string, string> = {}) {
  return execFileAsync(process.execPath, [SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl(),
      SUPER_ADMIN_EMAIL: TEST_EMAIL,
      SUPER_ADMIN_PASSWORD: 'integration-seed-password-1',
      ...overrides,
    },
  });
}

async function withClient<T>(run: (_connection: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function readCredential() {
  return withClient(async client => {
    const { rows } = await client.query(
      `SELECT u.id AS user_id, u.is_super_admin, u.is_active, a.password, a.provider_id
         FROM users u
         LEFT JOIN accounts a ON a.user_id = u.id AND a.provider_id = 'credential'
        WHERE u.email = $1`,
      [TEST_EMAIL]
    );
    return rows;
  });
}

beforeAll(async () => {
  testDatabaseUrl();
  await withClient(async client => {
    await client.query(
      'DELETE FROM users WHERE email = $1',
      [TEST_EMAIL]
    );
  });
});

afterAll(async () => {
  await withClient(async client => {
    await client.query('DELETE FROM users WHERE email = $1', [TEST_EMAIL]);
  });
});

describe('seed-super-admin script', () => {
  it('creates an active Super Admin with a verifiable credential hash', async () => {
    await runSeed();

    const rows = await readCredential();
    expect(rows).toHaveLength(1);
    expect(rows[0].is_super_admin).toBe(true);
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].provider_id).toBe('credential');

    await expect(
      verifyPassword({
        hash: rows[0].password as string,
        password: 'integration-seed-password-1',
      })
    ).resolves.toBe(true);
  });

  it('is idempotent and replaces the password on the next run', async () => {
    await runSeed({ SUPER_ADMIN_PASSWORD: 'integration-seed-password-2' });

    const rows = await readCredential();
    expect(rows).toHaveLength(1);
    expect(rows[0].is_super_admin).toBe(true);

    await expect(
      verifyPassword({
        hash: rows[0].password as string,
        password: 'integration-seed-password-2',
      })
    ).resolves.toBe(true);
    await expect(
      verifyPassword({
        hash: rows[0].password as string,
        password: 'integration-seed-password-1',
      })
    ).resolves.toBe(false);
  });

  it('reactivates and re-promotes an existing account', async () => {
    await withClient(async client => {
      await client.query(
        'UPDATE users SET is_active = false, is_super_admin = false, deleted_at = now() WHERE email = $1',
        [TEST_EMAIL]
      );
    });

    await runSeed();

    const rows = await readCredential();
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].is_super_admin).toBe(true);
  });

  it('fails without writing anything when the password is too short', async () => {
    await withClient(async client => {
      await client.query('DELETE FROM users WHERE email = $1', [TEST_EMAIL]);
    });

    await expect(runSeed({ SUPER_ADMIN_PASSWORD: 'short' })).rejects.toMatchObject({
      code: 1,
    });

    const rows = await readCredential();
    expect(rows).toHaveLength(0);
  });
});
