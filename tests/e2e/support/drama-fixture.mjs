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
 * @property {'draft' | 'published' | 'unpublished'} [publicationStatus]
 * @property {'coming_soon' | 'hidden'} [visibility]
 * @property {'draft' | 'published' | 'unpublished'} [seasonPublicationStatus]
 * @property {'draft' | 'published' | 'unpublished'} [episodePublicationStatus]
 * @property {number} [seasonCount]
 * @property {number} [episodesPerSeason]
 * @property {boolean} [withEpisodes]
 * @property {string | null} [episodeVideoSource]
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
    publicationStatus = 'draft',
    visibility = 'coming_soon',
    seasonPublicationStatus = 'draft',
    episodePublicationStatus = 'draft',
    seasonCount = 1,
    episodesPerSeason = 2,
    withEpisodes = true,
    episodeVideoSource = null,
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
        `INSERT INTO dramas (id, title, slug, structure_type, status, publication_status, visibility, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ongoing', $5, $6, now(), now())`,
        [id, title, slug, structureType, publicationStatus, visibility]
      );

      for (let seasonIndex = 0; seasonIndex < seasonCount; seasonIndex += 1) {
        const seasonId = randomUUID();
        seasonIds.push(seasonId);

        await run(
          client,
          'insert the seeded season',
          target,
          `INSERT INTO seasons (id, drama_id, title, position, publication_status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), now())`,
          [seasonId, id, `Season ${seasonIndex + 1}`, seasonIndex, seasonPublicationStatus]
        );

        if (!withEpisodes) {
          continue;
        }

        for (let episodeIndex = 0; episodeIndex < episodesPerSeason; episodeIndex += 1) {
          const episodeId = randomUUID();
          episodeIds.push(episodeId);

          // Episode numbers are drama-wide (D-032): Season 2 continues after
          // Season 1, and the database enforces the uniqueness per drama. The
          // position stays inside the episode's own season scope.
          const episodeNumber = seasonIndex * episodesPerSeason + episodeIndex + 1;

          await run(
            client,
            'insert the seeded episode',
            target,
            `INSERT INTO episodes (id, drama_id, season_id, title, episode_number, position, publication_status, video_source, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
            [
              episodeId,
              id,
              structureType === 'season_based' ? seasonId : null,
              `Episode ${seasonIndex + 1}.${episodeIndex + 1}`,
              episodeNumber,
              episodeIndex,
              episodePublicationStatus,
              episodeVideoSource,
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
 * Delete a drama created through the application (its id is unknown) by slug.
 *
 * Only the unique slug is matched; the helper removes the association rows a
 * create request writes and then the drama row itself. It is used by the
 * browser create test, which cannot seed an id ahead of time.
 *
 * @param {string} slug
 * @returns {Promise<void>}
 */
export async function removeDramaBySlug(slug) {
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
        'delete the created drama category rows',
        target,
        `DELETE FROM drama_categories WHERE drama_id IN (SELECT id FROM dramas WHERE slug = $1)`,
        [slug]
      );
      await run(
        client,
        'delete the created drama platform rows',
        target,
        `DELETE FROM drama_platforms WHERE drama_id IN (SELECT id FROM dramas WHERE slug = $1)`,
        [slug]
      );
      await run(
        client,
        'delete the created drama similar-drama links',
        target,
        `DELETE FROM similar_dramas
         WHERE drama_id IN (SELECT id FROM dramas WHERE slug = $1)
            OR similar_drama_id IN (SELECT id FROM dramas WHERE slug = $1)`,
        [slug]
      );
      await run(
        client,
        'delete the created subtitle tracks',
        target,
        `DELETE FROM subtitle_tracks
         WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id IN (SELECT id FROM dramas WHERE slug = $1))`,
        [slug]
      );
      await run(
        client,
        'delete the created playback failure reports',
        target,
        `DELETE FROM playback_failure_reports
         WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id IN (SELECT id FROM dramas WHERE slug = $1))`,
        [slug]
      );
      await run(
        client,
        'delete the created episodes',
        target,
        'DELETE FROM episodes WHERE drama_id IN (SELECT id FROM dramas WHERE slug = $1)',
        [slug]
      );
      await run(
        client,
        'delete the created seasons',
        target,
        'DELETE FROM seasons WHERE drama_id IN (SELECT id FROM dramas WHERE slug = $1)',
        [slug]
      );
      await run(
        client,
        'delete the created snapshots',
        target,
        'DELETE FROM structure_conversion_snapshots WHERE drama_id IN (SELECT id FROM dramas WHERE slug = $1)',
        [slug]
      );
      await run(client, 'delete the created drama', target, 'DELETE FROM dramas WHERE slug = $1', [
        slug,
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

/**
 * Delete a category or platform row by slug, together with any association
 * rows that reference it. Used by the taxonomy E2E tests, which create rows
 * through the browser and cannot know the id ahead of time.
 *
 * @param {'category' | 'platform'} resource
 * @param {string} slug
 * @returns {Promise<void>}
 */
export async function removeTaxonomyBySlug(resource, slug) {
  const { target, client } = requireTestClient();
  const table = resource === 'category' ? 'categories' : 'platforms';
  const joinTable = resource === 'category' ? 'drama_categories' : 'drama_platforms';

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
        'delete the created taxonomy join rows',
        target,
        `DELETE FROM ${joinTable} WHERE ${resource}_id IN (SELECT id FROM ${table} WHERE slug = $1)`,
        [slug]
      );
      await run(client, 'delete the created taxonomy row', target, `DELETE FROM ${table} WHERE slug = $1`, [
        slug,
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

/**
 * Delete the rows `seedDrama` created, and nothing else.
 *
 * @param {DramaFixture} fixture
 * @returns {Promise<void>}
 */
export async function removeDrama(fixture) {  const { target, client } = requireTestClient();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(client, 'begin the transaction', target, 'BEGIN');

    try {
      // A drama converted to a movie keeps a provenance FK from movies, and
      // ratings/reviews point at the movie. Remove those first so the seeded
      // drama and everything derived from it can be deleted.
      await run(
        client,
        'delete the converted movie join rows',
        target,
        `DELETE FROM movie_categories
         WHERE movie_id IN (SELECT id FROM movies WHERE converted_from_drama_id = $1)`,
        [fixture.id]
      );
      await run(
        client,
        'delete the converted movie platform rows',
        target,
        `DELETE FROM movie_platforms
         WHERE movie_id IN (SELECT id FROM movies WHERE converted_from_drama_id = $1)`,
        [fixture.id]
      );
      await run(
        client,
        'delete the converted movie ratings',
        target,
        `DELETE FROM ratings
         WHERE drama_id = $1
            OR movie_id IN (SELECT id FROM movies WHERE converted_from_drama_id = $1)`,
        [fixture.id]
      );
      await run(
        client,
        'delete the converted movie reviews',
        target,
        `DELETE FROM reviews
         WHERE drama_id = $1
            OR movie_id IN (SELECT id FROM movies WHERE converted_from_drama_id = $1)`,
        [fixture.id]
      );
      await run(
        client,
        'delete the converted movie',
        target,
        'DELETE FROM movies WHERE converted_from_drama_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the seeded subtitle tracks',
        target,
        `DELETE FROM subtitle_tracks
         WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = $1)`,
        [fixture.id]
      );
      await run(
        client,
        'delete the seeded playback failure reports',
        target,
        `DELETE FROM playback_failure_reports
         WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = $1)`,
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
        'delete the seeded episodes',
        target,
        'DELETE FROM episodes WHERE drama_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the seeded seasons',
        target,
        'DELETE FROM seasons WHERE drama_id = $1',
        [fixture.id]
      );
      await run(
        client,
        'delete the seeded snapshots',
        target,
        'DELETE FROM structure_conversion_snapshots WHERE drama_id = $1',
        [fixture.id]
      );
      // Recommendation links are written by the admin workflow, not by this
      // helper, but they belong to the seeded dramas and would otherwise
      // survive the cleanup as orphans.
      await run(
        client,
        'delete the seeded similar-drama links',
        target,
        'DELETE FROM similar_dramas WHERE drama_id = $1 OR similar_drama_id = $1',
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

/**
 * Read the stored video source of an episode.
 *
 * The browser test asserts what the database actually holds after a
 * replacement, so the check does not depend on what the page renders.
 *
 * @param {string} episodeId
 * @returns {Promise<string | null>}
 */
export async function readEpisodeVideoSource(episodeId) {
  const { target, client } = requireTestClient();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    const result = await run(
      client,
      'read the episode video source',
      target,
      'SELECT video_source FROM episodes WHERE id = $1',
      [episodeId]
    );

    return result.rows[0]?.video_source ?? null;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Insert a playback-failure report for an episode.
 *
 * The report is what a viewer submits when an external source does not play.
 * The helper writes the same row the application writes, so the admin list is
 * exercised against real data.
 *
 * @param {string} episodeId
 * @param {{ reason?: string, detail?: string | null }} [options]
 * @returns {Promise<string>} the report id
 */
export async function insertPlaybackFailure(episodeId, options = {}) {
  const { reason = 'network', detail = null } = options;
  const { target, client } = requireTestClient();
  const id = randomUUID();

  try {
    try {
      await client.connect();
    } catch {
      throw databaseFailure('connect to', target);
    }

    await run(
      client,
      'insert the playback failure report',
      target,
      `INSERT INTO playback_failure_reports (id, episode_id, reason, detail, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [id, episodeId, reason, detail]
    );

    return id;
  } finally {
    await client.end().catch(() => {});
  }
}
