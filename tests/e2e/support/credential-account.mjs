// Test-only helper that provisions the email/password Super Admin credential
// in the isolated test database, so the E2E suite can exercise the real
// Better Auth credential sign-in path instead of mocking it.
//
// It mirrors what `scripts/seed-super-admin.mjs` writes: one `users` row and
// one `accounts` row with `provider_id = 'credential'` and a scrypt hash.
//
// The helper refuses to run unless the target database name ends in "_test"
// and differs from DATABASE_URL. Database failures are re-thrown without the
// original error, because `pg` errors embed the connection string.

import { Client } from 'pg';
import { hashPassword } from 'better-auth/crypto';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

function requireTestClient() {
  const target = resolveTestDatabase({
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    mainDatabaseUrl: process.env.DATABASE_URL,
  });

  let client;
  try {
    client = new Client({ connectionString: target.url });
  } catch {
    throw new Error('The credential seeder could not create a database client.');
  }

  return { target, client };
}

async function run(client, operation, target, query, params) {
  try {
    return await client.query(query, params);
  } catch {
    throw new Error(
      `The credential seeder could not ${operation} on the test ` +
        `${describeDatabaseTarget(target)}. The underlying database error is not ` +
        'reported, to keep credentials out of the output.'
    );
  }
}

/**
 * Create (or replace) a Super Admin with an email/password credential.
 *
 * @param {{ email: string, password: string }} input
 * @returns {Promise<{ userId: string, email: string }>}
 */
export async function seedSuperAdminCredential({ email, password }) {
  const { target, client } = requireTestClient();
  const normalizedEmail = email.trim().toLowerCase();

  try {
    try {
      await client.connect();
    } catch {
      throw new Error(
        `The credential seeder could not connect to the test ${describeDatabaseTarget(target)}.`
      );
    }

    const passwordHash = await hashPassword(password);

    await run(client, 'begin a transaction', target, 'BEGIN');
    try {
      await run(client, 'clear a leftover session', target, 'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [
        normalizedEmail,
      ]);
      await run(client, 'insert the seeded user', target, `
        INSERT INTO users (name, email, email_verified, is_active, is_super_admin, role, created_at, updated_at)
        VALUES ('E2E Super Admin', $1, true, true, true, 'viewer', now(), now())
        ON CONFLICT (email) DO UPDATE
          SET is_super_admin = true,
              is_active = true,
              email_verified = true,
              deleted_at = NULL,
              updated_at = now()
      `, [normalizedEmail]);

      const { rows } = await run(client, 'read back the seeded user', target, 'SELECT id FROM users WHERE email = $1', [
        normalizedEmail,
      ]);
      const userId = rows[0]?.id;
      if (!userId) {
        throw new Error('The credential seeder could not read back the seeded user.');
      }

      await run(client, 'write the credential account', target, `
        INSERT INTO accounts (account_id, provider_id, user_id, password, created_at, updated_at)
        VALUES ($1, 'credential', $2, $3, now(), now())
        ON CONFLICT (provider_id, account_id) DO UPDATE SET password = excluded.password, updated_at = now()
      `, [userId, userId, passwordHash]);

      await run(client, 'commit the transaction', target, 'COMMIT');

      return { userId, email: normalizedEmail };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original outcome.
      }
      throw error;
    }
  } finally {
    await client.end();
  }
}

/**
 * Remove every row the seeder created for an email. Sessions and accounts
 * cascade from `users`.
 *
 * @param {string} email
 */
export async function removeSuperAdminCredential(email) {
  const { target, client } = requireTestClient();

  try {
    await client.connect();
  } catch {
    throw new Error('The credential seeder could not connect to remove seeded rows.');
  }

  try {
    await run(client, 'delete the seeded user', target, 'DELETE FROM users WHERE email = $1', [
      email.trim().toLowerCase(),
    ]);
  } finally {
    await client.end();
  }
}
