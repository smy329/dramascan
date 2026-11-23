// Sweep for end-to-end fixture rows that an interrupted run left behind.
//
// The end-to-end suite and the integration suite share one isolated test
// database. Each spec removes its own fixtures in a `finally` block, but a run
// that is interrupted (a killed process, a crashed worker, a failed
// deployment) never reaches that block, and the rows survive into the next
// run.
//
// Those leftovers are not harmless: a stale drama with the same title as a
// freshly seeded fixture makes a strict locator resolve to two elements, and
// enough stale rows push the fixture off the first page of the admin list.
//
// The sweep is deliberately narrow. It only matches rows the end-to-end suite
// itself creates, recognised by their `e2e-` slug or email prefix, and it only
// ever runs against the validated `_test` database.

import pg from 'pg';

const { Client } = pg;

/** The slug/email prefix every end-to-end fixture row carries. */
export const STALE_FIXTURE_PREFIX = 'e2e-';

const FIXTURE_DRAMA_IDS = `(SELECT id FROM dramas WHERE slug LIKE '${STALE_FIXTURE_PREFIX}%')`;
const FIXTURE_EPISODE_IDS = `(SELECT id FROM episodes WHERE drama_id IN ${FIXTURE_DRAMA_IDS})`;
const FIXTURE_MOVIE_IDS = `(SELECT id FROM movies WHERE slug LIKE '${STALE_FIXTURE_PREFIX}%' OR converted_from_drama_id IN ${FIXTURE_DRAMA_IDS})`;
const FIXTURE_USER_IDS = `(SELECT id FROM users WHERE email LIKE '${STALE_FIXTURE_PREFIX}%')`;

/**
 * The statements that remove every row the end-to-end suite can create.
 *
 * The order is the important part. Every child row is deleted before its
 * parent, because the content foreign keys use `RESTRICT` or `NO ACTION`:
 * deleting a drama that a rating still points at fails, and deleting a review
 * that a report still points at fails as well.
 *
 * @type {ReadonlyArray<{ key: string, sql: string }>}
 */
export const STALE_FIXTURE_STATEMENTS = Object.freeze([
  {
    key: 'reviewReports',
    sql: `DELETE FROM review_reports
          WHERE review_id IN (SELECT id FROM reviews WHERE drama_id IN ${FIXTURE_DRAMA_IDS} OR movie_id IN ${FIXTURE_MOVIE_IDS})
             OR user_id IN ${FIXTURE_USER_IDS}
             OR resolved_by IN ${FIXTURE_USER_IDS}`,
  },
  {
    key: 'reviewReactions',
    sql: `DELETE FROM review_reactions
          WHERE review_id IN (SELECT id FROM reviews WHERE drama_id IN ${FIXTURE_DRAMA_IDS} OR movie_id IN ${FIXTURE_MOVIE_IDS})
             OR user_id IN ${FIXTURE_USER_IDS}`,
  },
  {
    key: 'reviews',
    sql: `DELETE FROM reviews
          WHERE drama_id IN ${FIXTURE_DRAMA_IDS} OR movie_id IN ${FIXTURE_MOVIE_IDS}`,
  },
  {
    key: 'ratings',
    sql: `DELETE FROM ratings
          WHERE drama_id IN ${FIXTURE_DRAMA_IDS} OR movie_id IN ${FIXTURE_MOVIE_IDS}`,
  },
  {
    key: 'bookmarks',
    sql: `DELETE FROM bookmarks
          WHERE drama_id IN ${FIXTURE_DRAMA_IDS} OR movie_id IN ${FIXTURE_MOVIE_IDS}`,
  },
  {
    key: 'playbackProgress',
    sql: `DELETE FROM playback_progress
          WHERE drama_id IN ${FIXTURE_DRAMA_IDS}
             OR movie_id IN ${FIXTURE_MOVIE_IDS}
             OR episode_id IN ${FIXTURE_EPISODE_IDS}`,
  },
  {
    key: 'watchedState',
    sql: `DELETE FROM watched_state
          WHERE drama_id IN ${FIXTURE_DRAMA_IDS}
             OR movie_id IN ${FIXTURE_MOVIE_IDS}
             OR episode_id IN ${FIXTURE_EPISODE_IDS}`,
  },
  {
    key: 'watchHistory',
    sql: `DELETE FROM watch_history
          WHERE drama_id IN ${FIXTURE_DRAMA_IDS}
             OR movie_id IN ${FIXTURE_MOVIE_IDS}
             OR episode_id IN ${FIXTURE_EPISODE_IDS}`,
  },
  {
    key: 'dramaCategories',
    sql: `DELETE FROM drama_categories WHERE drama_id IN ${FIXTURE_DRAMA_IDS}`,
  },
  {
    key: 'dramaPlatforms',
    sql: `DELETE FROM drama_platforms WHERE drama_id IN ${FIXTURE_DRAMA_IDS}`,
  },
  {
    key: 'movieCategories',
    sql: `DELETE FROM movie_categories WHERE movie_id IN ${FIXTURE_MOVIE_IDS}`,
  },
  {
    key: 'moviePlatforms',
    sql: `DELETE FROM movie_platforms WHERE movie_id IN ${FIXTURE_MOVIE_IDS}`,
  },
  {
    key: 'similarDramas',
    sql: `DELETE FROM similar_dramas
          WHERE drama_id IN ${FIXTURE_DRAMA_IDS} OR similar_drama_id IN ${FIXTURE_DRAMA_IDS}`,
  },
  {
    key: 'conversionSnapshots',
    sql: `DELETE FROM structure_conversion_snapshots WHERE drama_id IN ${FIXTURE_DRAMA_IDS}`,
  },
  {
    key: 'subtitleTracks',
    sql: `DELETE FROM subtitle_tracks
          WHERE episode_id IN ${FIXTURE_EPISODE_IDS}`,
  },
  {
    key: 'playbackFailureReports',
    sql: `DELETE FROM playback_failure_reports
          WHERE episode_id IN ${FIXTURE_EPISODE_IDS}`,
  },
  {
    key: 'contentSlugHistory',
    sql: `DELETE FROM content_slug_history
          WHERE content_id IN ${FIXTURE_DRAMA_IDS}
             OR content_id IN ${FIXTURE_MOVIE_IDS}`,
  },
  {
    key: 'episodes',
    sql: `DELETE FROM episodes WHERE drama_id IN ${FIXTURE_DRAMA_IDS}`,
  },
  {
    key: 'seasons',
    sql: `DELETE FROM seasons WHERE drama_id IN ${FIXTURE_DRAMA_IDS}`,
  },
  {
    key: 'movies',
    sql: `DELETE FROM movies
          WHERE slug LIKE '${STALE_FIXTURE_PREFIX}%' OR converted_from_drama_id IN ${FIXTURE_DRAMA_IDS}`,
  },
  {
    key: 'dramas',
    sql: `DELETE FROM dramas WHERE slug LIKE '${STALE_FIXTURE_PREFIX}%'`,
  },
  {
    key: 'categories',
    sql: `DELETE FROM categories WHERE slug LIKE '${STALE_FIXTURE_PREFIX}%'`,
  },
  {
    key: 'platforms',
    sql: `DELETE FROM platforms WHERE slug LIKE '${STALE_FIXTURE_PREFIX}%'`,
  },
  {
    key: 'users',
    sql: `DELETE FROM users WHERE email LIKE '${STALE_FIXTURE_PREFIX}%'`,
  },
]);

/**
 * Remove every stale end-to-end fixture row from the validated test database.
 *
 * The whole sweep runs in one transaction: either the database is left exactly
 * as it was, or it ends without a single leftover row. Database errors are
 * re-thrown as a fixed message because a raw `pg` error embeds the connection
 * string, and therefore the password.
 *
 * @param {{ url: string, databaseName: string }} target
 * @returns {Promise<number>} the number of rows removed
 */
export async function removeStaleFixtures(target) {
  const client = new Client({ connectionString: target.url });

  try {
    await client.connect();
    await client.query('BEGIN');

    let removed = 0;

    try {
      for (const statement of STALE_FIXTURE_STATEMENTS) {
        const result = await client.query(statement.sql);
        removed += result.rowCount ?? 0;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});

      throw new Error(
        `The end-to-end fixture sweep could not clean up stale rows on the test ` +
          `database "${target.databaseName}". The underlying database error is not ` +
          'reported, to keep credentials out of the output.'
      );
    }

    return removed;
  } finally {
    await client.end().catch(() => {});
  }
}
