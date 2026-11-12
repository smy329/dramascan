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
//
// Every database operation is wrapped, because a raw `pg` error embeds the
// connection string — and therefore the password — in its message, and the
// test runner prints uncaught errors. Failures are re-thrown as fixed
// messages that name the operation and a credential-free description of the
// target instead. The seeded user and session are written in one transaction,
// so a failure between them cannot leave an orphan user row.

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { makeSignature } from 'better-auth/crypto';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

export const ADMIN_SESSION_COOKIE_NAME = 'better-auth.session_token';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

// Marks every row this helper writes, so cleanup never has to guess which
// sessions belong to it.
const SEEDED_USER_AGENT = 'e2e-seeder';

/** @typedef {{ email?: string, name?: string, superAdmin?: boolean }} SeedOptions */

/** @typedef {{ id: string }} IdRow */

/**
 * @typedef {object} SeededSession
 * @property {string} userId
 * @property {string} sessionId
 * @property {string} sessionToken
 * @property {string} cookieName
 * @property {string} cookieValue
 * @property {string} databaseName
 */

/** @typedef {string | SeededSession} SessionSubject */

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

/**
 * Build the error a failed database operation throws.
 *
 * `pg` puts the connection string — and therefore the password — in its own
 * error messages, and an uncaught error is printed by the test runner. The
 * original error is therefore dropped rather than attached as a cause, and the
 * message names only the operation and a credential-free target.
 *
 * @param {string} operation
 * @param {{ databaseName: string, host: string }} target
 * @returns {Error}
 */
function databaseFailure(operation, target) {
  return new Error(
    `The end-to-end session seeder could not ${operation} on the test ` +
      `${describeDatabaseTarget(target)}. Confirm the dedicated test database is running. ` +
      'The underlying database error is not reported, to keep credentials out of the output.'
  );
}

function requireTestClient() {
  const target = resolveTestDatabase({
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    mainDatabaseUrl: process.env.DATABASE_URL,
  });

  let client;

  try {
    client = new Client({ connectionString: target.url });
  } catch {
    throw databaseFailure('create a client for', target);
  }

  return { target, client };
}

/**
 * @param {Client} client
 * @param {string} operation
 * @param {{ databaseName: string, host: string }} target
 * @param {string} query
 * @param {unknown[]} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
async function run(client, operation, target, query, params) {
  try {
    return await client.query(query, params);
  } catch {
    throw databaseFailure(operation, target);
  }
}

/** Sign a value the way Better Auth signs its session cookie. */
async function signCookieValue(value, secret) {
  return `${value}.${await makeSignature(value, secret)}`;
}

/**
 * Seed a Super Admin user plus one session row in the isolated test database
 * and return the signed session cookie the browser must send back.
 *
 * Any row left behind for the requested email by a previous run is removed
 * first, inside the same transaction, so a crashed run cannot make the next
 * one fail on the unique `users.email` constraint.
 *
 * @param {SeedOptions} [options]
 * @returns {Promise<SeededSession>}
 */
async function seed({ email, name, superAdmin = true } = {}) {
  const secret = requireSecret();
  const { target, client } = requireTestClient();

  try {
    // Inside the try so the client is always closed, even when connecting
    // fails: `end()` on a client that never connected resolves.
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    const userEmail = email ?? `e2e-superadmin-${randomUUID()}@example.com`;
    const displayName = name ?? 'E2E Super Admin';
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

    await run(client, 'begin the transaction', target, 'BEGIN');

    try {
      await run(
        client,
        'clear a leftover row for the requested email',
        target,
        'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
        [userEmail]
      );
      await run(
        client,
        'clear a leftover row for the requested email',
        target,
        'DELETE FROM users WHERE email = $1',
        [userEmail]
      );

      await run(
        client,
        'insert the seeded user',
        target,
        `INSERT INTO users (name, email, email_verified, is_active, is_super_admin, role, created_at, updated_at)
         VALUES ($1, $2, true, true, $3, 'viewer', now(), now())`,
        [displayName, userEmail, superAdmin]
      );

      const { rows } = await run(
        client,
        'read back the seeded user',
        target,
        'SELECT id FROM users WHERE email = $1',
        [userEmail]
      );

      /** @type {IdRow | undefined} */
      const seededUser = rows[0];

      if (!seededUser) {
        throw new Error('Seeded user could not be read back.');
      }

      const sessionResult = await run(
        client,
        'insert the seeded session',
        target,
        `INSERT INTO sessions (expires_at, token, ip_address, user_agent, user_id, created_at, updated_at, last_activity_at)
         VALUES ($1, $2, '127.0.0.1', $3, $4, now(), now(), now())
         RETURNING id`,
        [expiresAt, sessionToken, SEEDED_USER_AGENT, seededUser.id]
      );

      /** @type {IdRow | undefined} */
      const seededSession = sessionResult.rows[0];

      if (!seededSession) {
        throw new Error('Seeded session could not be read back.');
      }

      await run(client, 'commit the transaction', target, 'COMMIT');

      return {
        userId: seededUser.id,
        sessionId: seededSession.id,
        sessionToken,
        cookieName: ADMIN_SESSION_COOKIE_NAME,
        cookieValue: await signCookieValue(sessionToken, secret),
        databaseName: target.databaseName,
      };
    } catch (error) {
      // Never let a failed rollback replace the real failure. Both this and
      // the error below carry fixed messages only.
      await run(client, 'roll the transaction back', target, 'ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Delete the rows `seed` created, and nothing else.
 *
 * Passing the object `seed` returned removes exactly that session row. Passing
 * a bare user id (as the spec does) removes every session this helper created
 * for that user — a session a real sign-in produced is never touched.
 *
 * @param {SessionSubject} subject
 * @returns {Promise<void>}
 */
async function remove(subject) {
  const { target, client } = requireTestClient();
  const isSeedResult = typeof subject !== 'string';
  const userId = isSeedResult ? subject.userId : subject;
  const sessionId = isSeedResult ? subject.sessionId : null;

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(client, 'begin the transaction', target, 'BEGIN');

    try {
      if (sessionId) {
        await run(
          client,
          'delete the seeded session',
          target,
          'DELETE FROM sessions WHERE id = $1',
          [sessionId]
        );
      } else {
        await run(
          client,
          'delete the seeded sessions',
          target,
          'DELETE FROM sessions WHERE user_id = $1 AND user_agent = $2',
          [userId, SEEDED_USER_AGENT]
        );
      }

      await run(client, 'delete the seeded user', target, 'DELETE FROM users WHERE id = $1', [
        userId,
      ]);

      await run(client, 'commit the transaction', target, 'COMMIT');
    } catch (error) {
      await run(client, 'roll the transaction back', target, 'ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

export const adminSession = { seed, remove };
