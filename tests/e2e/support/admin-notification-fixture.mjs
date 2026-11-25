// Test-only administrator-alert fixture for the end-to-end suite.
//
// It writes the row the platform's alert producers write — a content report
// alert, a failed announcement alert — so the browser exercises the real
// audience filter and the real per-administrator read state. Nothing is mocked.
//
// The helper refuses to run unless the target database name ends in "_test"
// and differs from DATABASE_URL. It only deletes the rows it created.

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

/**
 * @typedef {object} AdminNotificationInput
 * @property {string} title
 * @property {string} content
 * @property {'all' | 'super_admin' | 'roles'} [audience]
 * @property {string[] | null} [audienceRoles]
 * @property {'security' | 'content' | 'system' | 'maintenance'} [category]
 * @property {'normal' | 'high'} [priority]
 * @property {string | null} [link]
 */

function databaseFailure(operation, target) {
  return new Error(
    `The end-to-end admin-notification fixture could not ${operation} on the test ` +
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
 * Write one administrator alert.
 *
 * @param {AdminNotificationInput} input
 * @returns {Promise<{ id: string }>}
 */
export async function seedAdminNotification(input) {
  const { target, client } = requireTestClient();
  const id = randomUUID();
  const audience = input.audience ?? 'all';
  const audienceRoles = audience === 'roles' ? (input.audienceRoles ?? []) : null;

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(
      client,
      'insert the administrator alert',
      target,
      `INSERT INTO admin_notifications
         (id, title, content, audience, audience_roles, category, priority, link, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
      [
        id,
        input.title,
        input.content,
        audience,
        audienceRoles,
        input.category ?? 'system',
        input.priority ?? 'normal',
        input.link ?? null,
      ]
    );

    return { id };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Delete one administrator alert and its read state.
 *
 * @param {string} notificationId
 * @returns {Promise<void>}
 */
export async function removeAdminNotification(notificationId) {
  const { target, client } = requireTestClient();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(
      client,
      'delete the alert read state',
      target,
      'DELETE FROM admin_notification_reads WHERE notification_id = $1',
      [notificationId]
    );
    await run(
      client,
      'delete the administrator alert',
      target,
      'DELETE FROM admin_notifications WHERE id = $1',
      [notificationId]
    );
  } finally {
    await client.end().catch(() => {});
  }
}
