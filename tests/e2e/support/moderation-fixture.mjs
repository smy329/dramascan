// Test-only moderation helper for the end-to-end suite.
//
// It reads the rows the moderation workflow writes — the in-app notifications
// a reporter receives — so the browser test can prove that the reporter was
// actually told what happened.
//
// It refuses to run unless the target database name ends in "_test" and
// differs from DATABASE_URL. Database errors are re-thrown as fixed messages,
// because a raw `pg` error embeds the connection string and therefore the
// password.

import { Client } from 'pg';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

function databaseFailure(operation, target) {
  return new Error(
    `The end-to-end moderation helper could not ${operation} on the test ` +
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
 * Read the in-app notifications a user received.
 *
 * @param {string} userId
 * @returns {Promise<Array<{ id: string, title: string, content: string, event_type: string }>>}
 */
export async function readNotifications(userId) {
  const { target, client } = requireTestClient();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    let result;

    try {
      result = await client.query(
        `SELECT id, title, content, event_type
           FROM notifications
          WHERE user_id = $1
            AND deleted_at IS NULL
          ORDER BY created_at DESC`,
        [userId]
      );
    } catch {
      throw databaseFailure('read the notifications of', target);
    }

    return result.rows;
  } finally {
    await client.end().catch(() => {});
  }
}
