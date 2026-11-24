// Late-analytics cleanup for the end-to-end suite.
//
// The public details page reports its view in the background. That beacon can
// reach the server after the fixture has already deleted the dependent rows,
// and the `RESTRICT` foreign key from `content_view_events` then refuses the
// deletion of the content item.
//
// The helper below tolerates that race: it rolls back to a savepoint, waits
// for the beacons that are still on their way to land, removes the rows that
// arrived, and tries again. The wait matters — a retry that runs before the
// remaining beacons arrive would only fail again.
//
// The retry only happens for a foreign-key violation. Any other failure is a
// real problem and is reported as one. The reported message is fixed, because
// a raw `pg` error embeds the connection string — and therefore the password.

import { describeDatabaseTarget } from './database-target.mjs';

/** How many times the deletion is attempted. */
const MAX_ATTEMPTS = 6;

/** How long the helper waits for the remaining beacons to land, in milliseconds. */
const BEACON_SETTLE_MS = 250;

/**
 * The rows a late analytics beacon may have written for one content item.
 *
 * The rows are removed after a failed attempt, so the next attempt is not
 * blocked by the beacon that has just landed.
 *
 * @type {Readonly<Record<'drama' | 'movie', readonly string[]>>}
 */
export const LATE_ANALYTICS_CLEANUP = Object.freeze({
  drama: [
    'DELETE FROM content_view_events WHERE drama_id = $1',
    `DELETE FROM playback_analytics_events
      WHERE drama_id = $1
         OR episode_id IN (SELECT id FROM episodes WHERE drama_id = $1)`,
    'DELETE FROM analytics_daily_aggregates WHERE drama_id = $1',
  ],
  movie: [
    'DELETE FROM content_view_events WHERE movie_id = $1',
    'DELETE FROM playback_analytics_events WHERE movie_id = $1',
    'DELETE FROM analytics_daily_aggregates WHERE movie_id = $1',
  ],
});

/**
 * Wait for a number of milliseconds.
 *
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Delete one content row, tolerating an analytics beacon that lands during
 * the cleanup.
 *
 * @param {import('pg').Client} client the client, already inside a transaction
 * @param {{ databaseName: string, host: string }} target the database target, for the failure message
 * @param {'drama' | 'movie'} contentType the kind of content item
 * @param {string} contentId the id of the content item
 * @returns {Promise<void>}
 */
export async function deleteContentWithLateAnalyticsRetry(
  client,
  target,
  contentType,
  contentId
) {
  const table = contentType === 'drama' ? 'dramas' : 'movies';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await client.query('SAVEPOINT content_cleanup');

    try {
      await client.query(`DELETE FROM ${table} WHERE id = $1`, [contentId]);
      await client.query('RELEASE SAVEPOINT content_cleanup');
      return;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT content_cleanup');
      await client.query('RELEASE SAVEPOINT content_cleanup');

      // 23503 is a foreign-key violation. Any other code is not a race and
      // must not be retried.
      if (error?.code !== '23503' || attempt === MAX_ATTEMPTS) {
        throw new Error(
          `The end-to-end content seeder could not delete the seeded ${contentType} on the ` +
            `test ${describeDatabaseTarget(target)}. Confirm the dedicated test database is ` +
            'running. The underlying database error is not reported, to keep credentials out ' +
            'of the output.'
        );
      }

      // A beacon landed while the cleanup was running, and another one may
      // still be on its way. Wait for the stragglers, remove the rows that
      // arrived, and try again.
      await delay(BEACON_SETTLE_MS);

      for (const statement of LATE_ANALYTICS_CLEANUP[contentType]) {
        await client.query(statement, [contentId]);
      }
    }
  }
}
