// Test-only content helper for the end-to-end suite.
//
// It creates a standalone movie in the isolated test database so the browser
// tests can exercise the real public pages against a real row. It refuses to
// run unless the target database name ends in "_test" and differs from
// DATABASE_URL, and it deletes only the rows it created.
//
// Database errors are re-thrown as fixed messages: a raw `pg` error embeds
// the connection string, and therefore the password.

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

/**
 * @typedef {object} MovieFixture
 * @property {string} id
 * @property {string} title
 * @property {string} slug
 * @property {string | null} videoSource
 */

/**
 * @typedef {object} MovieSeedOptions
 * @property {string} [title]
 * @property {'draft' | 'published' | 'unpublished'} [publicationStatus]
 * @property {string | null} [videoSource]
 */

function databaseFailure(operation, target) {
  return new Error(
    `The end-to-end content seeder could not ${operation} on the test ` +
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
 * Seed one standalone movie.
 *
 * @param {MovieSeedOptions} [options]
 * @returns {Promise<MovieFixture>}
 */
export async function seedMovie(options = {}) {
  const {
    title = `E2E Movie ${randomUUID().slice(0, 8)}`,
    publicationStatus = 'draft',
    videoSource = null,
  } = options;

  const { target, client } = requireTestClient();
  const id = randomUUID();
  const slug = `e2e-movie-${randomUUID().slice(0, 12)}`;

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
        'insert the seeded movie',
        target,
        `INSERT INTO movies (id, title, slug, publication_status, video_source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [id, title, slug, publicationStatus, videoSource]
      );

      await run(client, 'commit the transaction', target, 'COMMIT');

      return { id, title, slug, videoSource };
    } catch (error) {
      await run(client, 'roll the transaction back', target, 'ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Delete the rows `seedMovie` created, and nothing else.
 *
 * @param {MovieFixture} fixture
 * @returns {Promise<void>}
 */
export async function removeMovie(fixture) {
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
        'delete the movie bookmark rows',
        target,
        'DELETE FROM bookmarks WHERE movie_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the movie progress rows',
        target,
        'DELETE FROM playback_progress WHERE movie_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the movie watched-state rows',
        target,
        'DELETE FROM watched_state WHERE movie_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the movie ratings',
        target,
        'DELETE FROM ratings WHERE movie_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the movie reviews',
        target,
        'DELETE FROM reviews WHERE movie_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the seeded slug history',
        target,
        'DELETE FROM content_slug_history WHERE content_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the seeded movie',
        target,
        'DELETE FROM movies WHERE id = $1',
        [fixture.id]
      );

      await run(client, 'commit the transaction', target, 'COMMIT');
    } catch (error) {
      await run(client, 'roll the transaction back', target, 'ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}
