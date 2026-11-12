// Test-only authentication helper for the end-to-end suite.
//
// It creates a Super Admin user and a session row in the isolated test
// database and signs the session cookie with Better Auth's own signature
// helper, so the application accepts it through its real session validation.
// Nothing is mocked: the session lookup, the account-status gate, the actor
// resolution, and the permission guard all run for real.
//
// The helper refuses to run unless the target database name ends in "_test"
// and differs from DATABASE_URL. It only deletes the rows it created.

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { makeSignature } from 'better-auth/crypto';

import { loadLocalEnv } from './load-local-env.mjs';
import { resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

export const ADMIN_SESSION_COOKIE_NAME = 'better-auth.session_token';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function requireSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be set to a real value of at least 32 characters before ' +
        'seeding an end-to-end session.'
    );
  }

  return secret;
}

function requireTestClient() {
  const target = resolveTestDatabase({
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    mainDatabaseUrl: process.env.DATABASE_URL,
  });

  return { target, client: new Client({ connectionString: target.url }) };
}

/** Sign a value the way Better Auth signs its session cookie. */
async function signCookieValue(value, secret) {
  return `${value}.${await makeSignature(value, secret)}`;
}

/**
 * Seed a Super Admin user plus one session row in the isolated test database
 * and return the signed session cookie the browser must send back.
 *
 * @param {{ email?: string, name?: string, superAdmin?: boolean }} [options]
 * @returns {Promise<{
 *   userId: string,
 *   sessionToken: string,
 *   cookieName: string,
 *   cookieValue: string,
 *   databaseName: string,
 * }>}
 */
async function seed({ email, name, superAdmin = true } = {}) {
  const secret = requireSecret();
  const { target, client } = requireTestClient();

  await client.connect();

  try {
    const userEmail = email ?? `e2e-superadmin-${randomUUID()}@example.com`;
    const displayName = name ?? 'E2E Super Admin';
    const sessionToken = randomUUID();

    await client.query(
      `INSERT INTO users (name, email, email_verified, is_active, is_super_admin, role, created_at, updated_at)
       VALUES ($1, $2, true, true, $3, 'viewer', now(), now())`,
      [displayName, userEmail, superAdmin]
    );

    const { rows } = await client.query('SELECT id FROM users WHERE email = $1', [userEmail]);

    if (!rows[0]) {
      throw new Error('Seeded user could not be read back.');
    }

    await client.query(
      `INSERT INTO sessions (expires_at, token, ip_address, user_agent, user_id, created_at, updated_at, last_activity_at)
       VALUES ($1, $2, '127.0.0.1', 'e2e-seeder', $3, now(), now(), now())`,
      [new Date(Date.now() + SESSION_LIFETIME_MS), sessionToken, rows[0].id]
    );

    return {
      userId: rows[0].id,
      sessionToken,
      cookieName: ADMIN_SESSION_COOKIE_NAME,
      cookieValue: await signCookieValue(sessionToken, secret),
      databaseName: target.databaseName,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Delete the session and user rows created by {@link seed}. Only rows that
 * belong to the given user id are removed; nothing else is touched.
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function remove(userId) {
  const { client } = requireTestClient();

  await client.connect();

  try {
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
  } finally {
    await client.end().catch(() => {});
  }
}

export const adminSession = { seed, remove };
