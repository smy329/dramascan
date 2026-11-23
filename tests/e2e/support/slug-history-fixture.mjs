// Test-only helper for the end-to-end suite.
//
// It records a slug change in `content_slug_history` so the browser tests can
// check that an old URL keeps working: the old URL redirects to the current
// canonical URL instead of answering 404 (requirements §4.3 and §6.6).
//
// The helper only ever writes to the validated `_test` database, and it
// deletes only the rows it created. Database errors are re-thrown as fixed
// messages: a raw `pg` error embeds the connection string, and therefore the
// password.

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

/**
 * @typedef {object} SlugChange
 * @property {'drama' | 'movie'} contentType
 * @property {string} contentId
 * @property {string} oldSlug
 * @property {string} newSlug
 */

/**
 * @typedef {object} SlugChangeFixture
 * @property {string} id
 * @property {'drama' | 'movie'} contentType
 * @property {string} contentId
 * @property {string} oldSlug
 * @property {string} newSlug
 */

function databaseFailure(operation, target) {
  return new Error(
    `The end-to-end slug-history helper could not ${operation} on the test ` +
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
 * Record one slug change.
 *
 * @param {SlugChange} change
 * @returns {Promise<SlugChangeFixture>}
 */
export async function recordSlugChange(change) {
  const { contentType, contentId, oldSlug, newSlug } = change;
  const { target, client } = requireTestClient();
  const id = randomUUID();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    try {
      await client.query(
        `INSERT INTO content_slug_history (id, content_type, content_id, old_slug, new_slug, changed_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [id, contentType, contentId, oldSlug, newSlug]
      );
    } catch {
      throw databaseFailure('record the slug change', target);
    }

    return { id, contentType, contentId, oldSlug, newSlug };
  } finally {
    await client.end().catch(() => {});
  }
}
