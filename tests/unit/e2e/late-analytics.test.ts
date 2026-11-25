import { describe, expect, it } from 'vitest';

import {
  deleteContentWithLateAnalyticsRetry,
  LATE_ANALYTICS_CLEANUP,
} from '../../e2e/support/late-analytics.mjs';

/**
 * Late-analytics cleanup for the end-to-end suite.
 *
 * The public pages report their views and their playback in the background. A
 * beacon can reach the server while the fixture is already deleting the rows
 * the beacon points at, and the restrictive foreign key then refuses the
 * deletion.
 *
 * The helper tolerates that race: it rolls back to a savepoint, waits for the
 * beacons that are still on their way, removes the rows that arrived, and
 * tries again. The deletion of the **whole hierarchy** has to be inside that
 * savepoint — the episode rows are deleted before the drama row, and a beacon
 * that lands in between blocks the episode deletion just as it blocks the
 * drama deletion.
 */

type QueryCall = { sql: string; params?: unknown[] };

/** A client that records the statements it was asked to run. */
type RecordingClient = {
  calls: QueryCall[];
  query: (
    _sql: string,
    _params?: unknown[]
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
};

/**
 * Build a client that fails the statements the behaviour rejects.
 *
 * @param failure decides whether a statement fails, and with what
 */
function createClient(
  failure: (_statement: string) => Error | null
): RecordingClient {
  const calls: QueryCall[] = [];

  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });

      const error = failure(sql);

      if (error) {
        throw error;
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

/** The error PostgreSQL raises for an `ON DELETE RESTRICT` foreign key. */
function restrictViolation(): Error {
  const error = new Error('restrict violation') as Error & {
    code: string;
    constraint: string;
  };
  error.code = '23001';
  error.constraint = 'fk_playback_analytics_events_episode_id';

  return error;
}

/** The error PostgreSQL raises for an `ON DELETE NO ACTION` foreign key. */
function foreignKeyViolation(): Error {
  const error = new Error('foreign key violation') as Error & { code: string };
  error.code = '23503';

  return error;
}

/** The target the helper reports in its failure message. */
const TARGET = { databaseName: 'dramascan_test', host: 'localhost:5432' };

describe('deleteContentWithLateAnalyticsRetry', () => {
  it('retries the dependent deletes when a late beacon blocks them', async () => {
    // The first episode deletion is refused: a playback beacon for that
    // episode landed while the cleanup was running.
    let blocked = true;
    const client = createClient(sql => {
      if (blocked && sql.includes('DELETE FROM episodes')) {
        blocked = false;
        return restrictViolation();
      }

      return null;
    });

    await deleteContentWithLateAnalyticsRetry(
      client as never,
      TARGET,
      'drama',
      'drama-id',
      ['DELETE FROM episodes WHERE drama_id = $1']
    );

    const episodeDeletes = client.calls.filter(call => call.sql.includes('DELETE FROM episodes'));

    // The dependent deletion ran once per attempt: it is inside the savepoint,
    // so the refusal rolls it back and the retry runs it again.
    expect(episodeDeletes).toHaveLength(2);

    // The late rows were removed between the attempts, so the second attempt
    // is not blocked by the beacon that has just landed.
    for (const statement of LATE_ANALYTICS_CLEANUP.drama) {
      expect(client.calls.some(call => call.sql === statement)).toBe(true);
    }

    expect(client.calls.some(call => call.sql === 'RELEASE SAVEPOINT content_cleanup')).toBe(true);
  });

  it('retries a refusal reported as a foreign-key violation', async () => {
    // PostgreSQL reports `23001` for `ON DELETE RESTRICT` and `23503` for
    // `ON DELETE NO ACTION`. Both mean the same thing here, and both are
    // retried: watching only one of them reported a correct application as a
    // broken fixture.
    let blocked = true;
    const client = createClient(sql => {
      if (blocked && sql.includes('DELETE FROM episodes')) {
        blocked = false;
        return foreignKeyViolation();
      }

      return null;
    });

    await deleteContentWithLateAnalyticsRetry(
      client as never,
      TARGET,
      'drama',
      'drama-id',
      ['DELETE FROM episodes WHERE drama_id = $1']
    );

    expect(
      client.calls.filter(call => call.sql.includes('DELETE FROM episodes'))
    ).toHaveLength(2);
  });

  it('reports the statement and the constraint that were refused', async () => {
    const client = createClient(sql => {
      if (sql.includes('DELETE FROM episodes')) {
        return restrictViolation();
      }

      return null;
    });

    await expect(
      deleteContentWithLateAnalyticsRetry(
        client as never,
        TARGET,
        'drama',
        'drama-id',
        ['DELETE FROM episodes WHERE drama_id = $1']
      )
    ).rejects.toThrow(/SQLSTATE 23001.*fk_playback_analytics_events_episode_id/s);
  });

  it('deletes the content row when nothing blocks the deletion', async () => {
    const client = createClient(() => null);

    await deleteContentWithLateAnalyticsRetry(
      client as never,
      TARGET,
      'drama',
      'drama-id',
      ['DELETE FROM episodes WHERE drama_id = $1']
    );

    const statements = client.calls.map(call => call.sql);

    expect(statements).toContain('DELETE FROM episodes WHERE drama_id = $1');
    expect(statements).toContain('DELETE FROM dramas WHERE id = $1');
    // One attempt, one savepoint.
    expect(statements.filter(sql => sql === 'SAVEPOINT content_cleanup')).toHaveLength(1);
  });

  it('deletes the content row on its own when no dependent delete is given', async () => {
    const client = createClient(() => null);

    await deleteContentWithLateAnalyticsRetry(client as never, TARGET, 'movie', 'movie-id');

    const statements = client.calls.map(call => call.sql);

    expect(statements).toContain('DELETE FROM movies WHERE id = $1');
  });

  it('does not retry a failure that is not a reference violation', async () => {
    const client = createClient(sql => {
      if (sql.includes('DELETE FROM dramas')) {
        return new Error('connection lost');
      }

      return null;
    });

    await expect(
      deleteContentWithLateAnalyticsRetry(client as never, TARGET, 'drama', 'drama-id')
    ).rejects.toThrow(/could not delete the seeded drama/);

    const statements = client.calls.map(call => call.sql);

    expect(statements.filter(sql => sql === 'SAVEPOINT content_cleanup')).toHaveLength(1);
  });
});
