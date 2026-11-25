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
// The retry only happens for a refusal because a child row still points at
// the row that is being deleted. Any other failure is a real problem and is
// reported as one. The reported message is fixed, because a raw `pg` error
// embeds the connection string — and therefore the password.

import { describeDatabaseTarget } from './database-target.mjs';

/** How many times the deletion is attempted. */
const MAX_ATTEMPTS = 10;

/**
 * The SQLSTATE of a refused deletion because a child row still points at it.
 *
 * PostgreSQL reports two codes for the same situation, and which one it uses
 * depends on the foreign key's delete rule:
 *
 *   - `23001` (`restrict_violation`) for `ON DELETE RESTRICT`;
 *   - `23503` (`foreign_key_violation`) for `ON DELETE NO ACTION`.
 *
 * The analytics tables use `RESTRICT`, so the deletion of a drama that a late
 * beacon still points at is refused with `23001`. A helper that watches only
 * `23503` treats that refusal as a hard failure and reports a correct
 * application as broken.
 */
const RESTRICT_VIOLATION_CODE = '23001';

/** The SQLSTATE of a refused deletion because of a `NO ACTION` foreign key. */
const FOREIGN_KEY_VIOLATION_CODE = '23503';

/**
 * Is this SQLSTATE the race the retry exists for?
 *
 * @param {string} code the SQLSTATE of the failure
 * @returns {boolean}
 */
function isReferenceViolation(code) {
  return code === RESTRICT_VIOLATION_CODE || code === FOREIGN_KEY_VIOLATION_CODE;
}

/**
 * How long the helper waits for the remaining beacons to land, in milliseconds.
 *
 * The beacon is fire-and-forget: the browser sends it while the page is being
 * torn down, and on a loaded machine it can take a few seconds to reach the
 * server. The wait has to be longer than that, or a correct application — which
 * drops a beacon about a title that no longer exists — is reported as a broken
 * fixture.
 */
const BEACON_SETTLE_MS = 500;

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
 * The deletions that have to happen *before* the content row — the episodes of
 * a drama, for instance — are passed as `dependentStatements`. They run inside
 * the same savepoint as the content deletion, so a beacon that blocks one of
 * them rolls the whole attempt back and the retry runs them again. A beacon
 * that lands between the episode deletion and the drama deletion would
 * otherwise fail the episode deletion with a foreign-key violation and abort
 * the cleanup.
 *
 * @param {import('pg').Client} client the client, already inside a transaction
 * @param {{ databaseName: string, host: string }} target the database target, for the failure message
 * @param {'drama' | 'movie'} contentType the kind of content item
 * @param {string} contentId the id of the content item
 * @param {readonly string[]} [dependentStatements] the deletions to run before the content row, each taking the content id as `$1`
 * @returns {Promise<void>}
 */
export async function deleteContentWithLateAnalyticsRetry(
  client,
  target,
  contentType,
  contentId,
  dependentStatements = []
) {
  const table = contentType === 'drama' ? 'dramas' : 'movies';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await client.query('SAVEPOINT content_cleanup');

    // The statement that is running, so a failure can name it.
    let failingStatement = `DELETE FROM ${table} WHERE id = $1`;

    try {
      for (const statement of dependentStatements) {
        failingStatement = statement;
        await client.query(statement, [contentId]);
      }

      await client.query(`DELETE FROM ${table} WHERE id = $1`, [contentId]);
      await client.query('RELEASE SAVEPOINT content_cleanup');
      return;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT content_cleanup');
      await client.query('RELEASE SAVEPOINT content_cleanup');

      // A refusal because a child row still points at this row is a race:
      // another code is not, and must not be retried.
      const code = typeof error?.code === 'string' ? error.code : 'unknown';
      const constraint = typeof error?.constraint === 'string' ? error.constraint : null;

      if (!isReferenceViolation(code) || attempt === MAX_ATTEMPTS) {
        throw new Error(
          `The end-to-end content seeder could not delete the seeded ${contentType} on the ` +
            `test ${describeDatabaseTarget(target)}. The statement ` +
            `${describeStatement(failingStatement)} was refused with SQLSTATE ${code}` +
            `${constraint === null ? '' : ` (constraint ${constraint})`}. The connection ` +
            'details are not reported, to keep credentials out of the output.'
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

/**
 * Describe the statement that was refused.
 *
 * The statement names a table and a predicate; it never carries a value, so
 * it is safe to report.
 *
 * @param {string} statement
 * @returns {string}
 */
function describeStatement(statement) {
  const normalized = statement.replace(/\s+/g, ' ').trim();

  return `"${normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized}"`;
}
