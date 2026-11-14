// Test-only content helper for the end-to-end suite.
//
// It creates a drama (and optional seasons/episodes) in the isolated test
// database so the browser tests can exercise the real admin pages against
// real rows. It refuses to run unless the target database name ends in
// "_test" and differs from DATABASE_URL, and it deletes only the rows it
// created.
//
// Database errors are re-thrown as fixed messages: a raw `pg` error embeds
// the connection string, and therefore the password.

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { loadLocalEnv } from './load-local-env.mjs';
import { describeDatabaseTarget, resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

/**
 * @typedef {object} DramaFixture
 * @property {string} id
 * @property {string} title
 * @property {string} slug
 * @property {'flat' | 'season_based'} structureType
 * @property {string[]} seasonIds
 * @property {string[]} episodeIds
 */

/**
 * @typedef {object} DramaSeedOptions
 * @property {string} [title]
 * @property {'flat' | 'season_based'} [structureType]
 * @property {number} [seasonCount]
 * @property {number} [episodesPerSeason]
 * @property {boolean} [withEpisodes]
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
 * Seed one drama with the requested structure.
 *
 * @param {DramaSeedOptions} [options]
 * @returns {Promise<DramaFixture>}
 */
export async function seedDrama(options = {}) {
  const {
    title = `E2E Drama ${randomUUID().slice(0, 8)}`,
    structureType = 'season_based',
    seasonCount = 1,
    episodesPerSeason = 2,
    withEpisodes = true,
  } = options;

  const { target, client } = requireTestClient();
  const id = randomUUID();
  const slug = `e2e-drama-${randomUUID().slice(0, 12)}`;
  const seasonIds = [];
  const episodeIds = [];

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
        'insert the seeded drama',
        target,
        `INSERT INTO dramas (id, title, slug, structure_type, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ongoing', now(), now())`,
        [id, title, slug, structureType]
      );

      for (let seasonIndex = 0; seasonIndex < seasonCount; seasonIndex += 1) {
        const seasonId = randomUUID();
        seasonIds.push(seasonId);

        await run(
          client,
          'insert the seeded season',
          target,
          `INSERT INTO seasons (id, drama_id, title, position, created_at, updated_at)
           VALUES ($1, $2, $3, $4, now(), now())`,
          [seasonId, id, `Season ${seasonIndex + 1}`, seasonIndex]
        );

        if (!withEpisodes) {
          continue;
        }

        for (let episodeIndex = 0; episodeIndex < episodesPerSeason; episodeIndex += 1) {
          const episodeId = randomUUID();
          episodeIds.push(episodeId);

          await run(
            client,
            'insert the seeded episode',
            target,
            `INSERT INTO episodes (id, drama_id, season_id, title, episode_number, position, publication_status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'ongoing', now(), now())`,
            [
              episodeId,
              id,
              structureType === 'season_based' ? seasonId : null,
              `Episode ${seasonIndex + 1}.${episodeIndex + 1}`,
              episodeIndex + 1,
              episodeIndex,
            ]
          );
        }
      }

      await run(client, 'commit the transaction', target, 'COMMIT');

      return { id, title, slug, structureType, seasonIds, episodeIds };
    } catch (error) {
      await run(client, 'roll the transaction back', target, 'ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Delete the rows `seedDrama` created, and nothing else.
 *
 * @param {DramaFixture} fixture
 * @returns {Promise<void>}
 */
export async function removeDrama(fixture) {
  const { target, client } = requireTestClient();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(client, 'begin the transaction', target, 'BEGIN');

    try {
      await run(client, 'delete the seeded episodes', target, 'DELETE FROM episodes WHERE drama_id = $1', [
        fixture.id,
      ]);
      await run(client, 'delete the seeded seasons', target, 'DELETE FROM seasons WHERE drama_id = $1', [
        fixture.id,
      ]);
      await run(
        client,
        'delete the seeded snapshots',
        target,
        'DELETE FROM structure_conversion_snapshots WHERE drama_id = $1',
        [fixture.id]
      );
      await run(client, 'delete the seeded drama', target, 'DELETE FROM dramas WHERE id = $1', [
        fixture.id,
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
