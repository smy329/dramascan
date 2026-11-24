// Test-only notification fixture for the end-to-end suite.
//
// It writes the rows a real notification workflow would have written — an
// in-app notification row and its delivery record — so the browser exercises
// the application's real notification reads, filters, and mark-read writes.
// Nothing is mocked.
//
// The helper refuses to run unless the target database name ends in "_test"
// and differs from DATABASE_URL. It only deletes the rows it created.

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

/**
 * @typedef {object} NotificationInput
 * @property {string} userId
 * @property {string} title
 * @property {string} content
 * @property {string} [eventType]
 * @property {string | null} [link]
 * @property {boolean} [isRead]
 */

function databaseFailure(operation, target) {
  return new Error(
    `The end-to-end notification fixture could not ${operation} on the test ` +
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
 * Write one in-app notification for a viewer.
 *
 * @param {NotificationInput} input
 * @returns {Promise<{ id: string }>}
 */
export async function seedNotification(input) {
  const { target, client } = requireTestClient();
  const id = randomUUID();
  const eventType = input.eventType ?? 'new_drama';
  const isRead = input.isRead ?? false;

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(
      client,
      'insert the notification',
      target,
      `INSERT INTO notifications
         (id, user_id, title, content, event_type, link, is_read, read_at, delivered, delivery_timestamp, priority, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, case when $7 then now() else null end, true, now(), 'normal', now(), now())`,
      [id, input.userId, input.title, input.content, eventType, input.link ?? null, isRead]
    );

    await run(
      client,
      'insert the delivery record',
      target,
      `INSERT INTO notification_deliveries
         (id, notification_id, user_id, channel, success, delivered_at, created_at)
       VALUES ($1, $2, $3, 'in_app', true, now(), now())`,
      [randomUUID(), id, input.userId]
    );

    return { id };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Delete every notification row that belongs to a viewer.
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function removeNotifications(userId) {
  const { target, client } = requireTestClient();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(
      client,
      'delete the delivery records',
      target,
      'DELETE FROM notification_deliveries WHERE user_id = $1',
      [userId]
    );
    await run(client, 'delete the notifications', target, 'DELETE FROM notifications WHERE user_id = $1', [
      userId,
    ]);
    await run(
      client,
      'delete the preference rows',
      target,
      'DELETE FROM notification_preferences WHERE user_id = $1',
      [userId]
    );
  } finally {
    await client.end().catch(() => {});
  }
}
