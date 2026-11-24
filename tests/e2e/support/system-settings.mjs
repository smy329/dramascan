// Test-only homepage-settings helper for the end-to-end suite.
//
// The homepage settings live in `system_settings`, which is shared by the whole
// test database. A browser test that changes the featured item, the hero
// rotation, or the Trending pins must put the rows back, or every later test
// would inherit the previous test's homepage.
//
// It refuses to run unless the target database name ends in "_test" and
// differs from DATABASE_URL. It only touches the five homepage setting keys
// and the audit rows of the administrator the test created.
//
// Database errors are re-thrown as fixed messages, because a raw `pg` error
// embeds the connection string and therefore the password.

import { Client } from 'pg';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

/** The setting keys the homepage pages write. */
export const HOMEPAGE_SETTING_KEYS = [
  'featured_content_id',
  'featured_content_type',
  'hero_rotation_enabled',
  'hero_rotation_item_ids',
  'trending_pinned_item_ids',
];

function databaseFailure(operation, target) {
  return new Error(
    `The end-to-end homepage-settings helper could not ${operation} on the test ` +
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

async function run(client, operation, target, query, params) {
  try {
    return await client.query(query, params);
  } catch {
    throw databaseFailure(operation, target);
  }
}

/**
 * Read the current homepage setting rows.
 *
 * The snapshot keeps every column, so restoring it puts the rows back exactly
 * as they were — including a row that did not exist before the test.
 *
 * @returns {Promise<Array<{ id: string, key: string, description: string | null, boolean_value: boolean | null, string_value: string | null, value: unknown, updated_by: string | null, created_at: Date, updated_at: Date }>>}
 */
export async function snapshotHomepageSettings() {
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
        `SELECT id, key, description, boolean_value, string_value, value, updated_by, created_at, updated_at
           FROM system_settings
          WHERE key = ANY($1::text[])
          ORDER BY key`,
        [HOMEPAGE_SETTING_KEYS]
      );
    } catch {
      throw databaseFailure('read the homepage settings of', target);
    }

    return result.rows;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Put the homepage setting rows back.
 *
 * The rows the test wrote are removed and the snapshot rows are written back
 * with their original identifiers, so the shared test database keeps exactly
 * the state it had before the test.
 *
 * @param {Awaited<ReturnType<typeof snapshotHomepageSettings>>} snapshot
 * @returns {Promise<void>}
 */
export async function restoreHomepageSettings(snapshot) {
  const { target, client } = requireTestClient();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(client, 'begin the transaction', target, 'BEGIN');

    try {
      await run(
        client,
        'delete the homepage settings the test wrote',
        target,
        `DELETE FROM system_settings WHERE key = ANY($1::text[])`,
        [HOMEPAGE_SETTING_KEYS]
      );

      for (const row of snapshot) {
        await run(
          client,
          'restore a homepage setting row',
          target,
          `INSERT INTO system_settings (id, key, description, boolean_value, string_value, value, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            row.id,
            row.key,
            row.description,
            row.boolean_value,
            row.string_value,
            row.value ?? null,
            row.updated_by,
            row.created_at,
            row.updated_at,
          ]
        );
      }

      await run(client, 'commit the transaction', target, 'COMMIT');
    } catch (error) {
      await run(client, 'roll the transaction back', target, 'ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Delete the audit rows an administrator created.
 *
 * The audit trail outlives the administrator by design, so the rows would
 * otherwise stay behind in the shared test database. The cleanup is scoped by
 * the exact administrator id and never touches another audit row.
 *
 * @param {string} actorUserId
 * @returns {Promise<void>}
 */
export async function deleteAuditEventsForActor(actorUserId) {
  const { target, client } = requireTestClient();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(
      client,
      'delete the audit rows of the administrator',
      target,
      'DELETE FROM admin_audit_log WHERE actor_id = $1',
      [actorUserId]
    );
  } finally {
    await client.end().catch(() => {});
  }
}
