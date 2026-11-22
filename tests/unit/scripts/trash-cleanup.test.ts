import { describe, expect, it } from 'vitest';

import {
  CLEANUP_ORDER,
  DEFAULT_BATCH_SIZE,
  DEFAULT_RETENTION_DAYS,
  MAX_BATCH_SIZE,
  TABLE_BY_CONTENT_TYPE,
  buildCleanupStatements,
  createLogger,
  findConvertedMovie,
  lockExpiredRow,
  parsePositiveInteger,
  quote,
  runTrashCleanup,
} from '../../../scripts/trash-cleanup.mjs';

/**
 * Trash expiry command helpers.
 *
 * The command is the only automatic permanent-deletion path, so its SQL and
 * its configuration parsing are pinned here: a mistake in either would delete
 * the wrong rows.
 */

const DRAMA_ID = '11111111-1111-4111-8111-111111111111';
const EPISODE_ID = '22222222-2222-4222-8222-222222222222';
const SEASON_ID = '33333333-3333-4333-8333-333333333333';

function sqlFor(statements: readonly { key: string; sql: string }[], key: string): string {
  const statement = statements.find(entry => entry.key === key);

  if (!statement) {
    throw new Error(`No statement named "${key}".`);
  }

  return statement.sql;
}

describe('CLEANUP_ORDER', () => {
  it('uses the singular content types the rest of the command expects', () => {
    expect(CLEANUP_ORDER).toEqual(['episode', 'season', 'movie', 'drama']);
  });

  it('maps every content type to its own table', () => {
    expect(TABLE_BY_CONTENT_TYPE.drama).toBe('dramas');
    expect(TABLE_BY_CONTENT_TYPE.season).toBe('seasons');
    expect(TABLE_BY_CONTENT_TYPE.episode).toBe('episodes');
    expect(TABLE_BY_CONTENT_TYPE.movie).toBe('movies');
  });

  it('removes the hierarchy from the leaves up', () => {
    expect(CLEANUP_ORDER.indexOf('episode')).toBeLessThan(CLEANUP_ORDER.indexOf('season'));
    expect(CLEANUP_ORDER.indexOf('season')).toBeLessThan(CLEANUP_ORDER.indexOf('drama'));
  });
});

describe('parsePositiveInteger', () => {
  it('accepts a positive integer', () => {
    expect(parsePositiveInteger('45', DEFAULT_RETENTION_DAYS)).toBe(45);
  });

  it('falls back for a missing or malformed value', () => {
    expect(parsePositiveInteger(undefined, DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('abc', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('0', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('-2', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('1.5', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
  });

  it('never exceeds the configured maximum', () => {
    expect(parsePositiveInteger('100000', DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE)).toBe(MAX_BATCH_SIZE);
  });
});

describe('quote', () => {
  it('escapes a single quote so the literal stays valid', () => {
    expect(quote("O'Brien")).toBe("'O''Brien'");
  });
});

describe('buildCleanupStatements', () => {
  it('removes the personal records of a drama', () => {
    const statements = buildCleanupStatements({
      contentType: 'drama',
      id: DRAMA_ID,
      episodeIds: [EPISODE_ID],
      seasonIds: [SEASON_ID],
    });

    expect(sqlFor(statements, 'bookmarks')).toContain('delete from bookmarks');
    expect(sqlFor(statements, 'playbackProgress')).toContain('delete from playback_progress');
    expect(sqlFor(statements, 'watchedState')).toContain('delete from watched_state');
    expect(sqlFor(statements, 'watchHistory')).toContain('delete from watch_history');
  });

  it('anonymizes the ratings and reviews instead of deleting them', () => {
    const statements = buildCleanupStatements({
      contentType: 'drama',
      id: DRAMA_ID,
      episodeIds: [],
      seasonIds: [],
    });

    const ratings = sqlFor(statements, 'ratings');
    const reviews = sqlFor(statements, 'reviews');

    expect(ratings).toContain('update ratings set user_id = null');
    expect(ratings).toContain('anonymized_at = now()');
    expect(ratings).toContain('drama_id = null');
    expect(reviews).toContain('update reviews set user_id = null');
    expect(reviews).toContain('anonymized_at = now()');
  });

  it('deletes the hierarchy from the leaves up', () => {
    const statements = buildCleanupStatements({
      contentType: 'drama',
      id: DRAMA_ID,
      episodeIds: [EPISODE_ID],
      seasonIds: [SEASON_ID],
    });

    const keys = statements.map(statement => statement.key);

    expect(keys.indexOf('episodes')).toBeLessThan(keys.indexOf('seasons'));
    expect(keys.indexOf('seasons')).toBeLessThan(keys.indexOf('dramas'));
    expect(keys).toContain('similarDramas');
    expect(keys).toContain('dramaCategories');
    expect(keys).toContain('dramaPlatforms');
  });

  it('removes an episode by its own id', () => {
    const statements = buildCleanupStatements({
      contentType: 'episode',
      id: EPISODE_ID,
      episodeIds: [],
      seasonIds: [],
    });

    expect(sqlFor(statements, 'playbackProgress')).toContain(`episode_id = '${EPISODE_ID}'`);
    expect(sqlFor(statements, 'watchedState')).toContain(`episode_id = '${EPISODE_ID}'`);
    expect(sqlFor(statements, 'watchHistory')).toContain(`episode_id = '${EPISODE_ID}'`);
    expect(sqlFor(statements, 'episodes')).toContain(`id = '${EPISODE_ID}'`);
  });

  it('removes a movie without touching the drama tables', () => {
    const statements = buildCleanupStatements({
      contentType: 'movie',
      id: DRAMA_ID,
      episodeIds: [],
      seasonIds: [],
    });

    const keys = statements.map(statement => statement.key);

    expect(keys).toContain('movies');
    expect(keys).toContain('movieCategories');
    expect(keys).toContain('moviePlatforms');
    expect(keys).not.toContain('similarDramas');
    expect(sqlFor(statements, 'ratings')).toContain('movie_id = null');
  });

  it('removes the legacy personal records that only carry content_type/content_id', () => {
    const statements = buildCleanupStatements({
      contentType: 'drama',
      id: DRAMA_ID,
      episodeIds: [],
      seasonIds: [],
    });

    for (const key of ['bookmarks', 'playbackProgress', 'watchedState', 'watchHistory']) {
      expect(sqlFor(statements, key)).toContain(`content_type = 'drama'`);
      expect(sqlFor(statements, key)).toContain(`content_id = '${DRAMA_ID}'`);
    }
  });

  it('never deletes a row that is not in the Trash', () => {
    const statements = buildCleanupStatements({
      contentType: 'drama',
      id: DRAMA_ID,
      episodeIds: [EPISODE_ID],
      seasonIds: [SEASON_ID],
    });

    expect(sqlFor(statements, 'dramas')).toContain('deleted_at is not null');
    expect(sqlFor(statements, 'seasons')).toContain('deleted_at is not null');
    expect(sqlFor(statements, 'episodes')).toContain('deleted_at is not null');
  });
});

describe('lockExpiredRow', () => {
  it('locks the row and only accepts a row that is still trashed', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ id: DRAMA_ID }], rowCount: 1 };
      },
    };

    const locked = await lockExpiredRow(client, 'drama', DRAMA_ID);

    expect(locked).toBe(true);
    expect(queries[0]).toContain('from dramas');
    expect(queries[0]).toContain('deleted_at is not null');
    expect(queries[0]).toContain('for update');
  });

  it('reports that the row is gone or restored', async () => {
    const client = {
      query: async () => ({ rows: [], rowCount: 0 }),
    };

    await expect(lockExpiredRow(client, 'movie', DRAMA_ID)).resolves.toBe(false);
  });
});

describe('findConvertedMovie', () => {
  it('looks up the movie that keeps the provenance of the drama', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ title: 'Converted Movie' }], rowCount: 1 };
      },
    };

    await expect(findConvertedMovie(client, DRAMA_ID)).resolves.toBe('Converted Movie');
    expect(queries[0]).toContain('converted_from_drama_id');
  });

  it('returns null when the drama was never converted', async () => {
    const client = {
      query: async () => ({ rows: [], rowCount: 0 }),
    };

    await expect(findConvertedMovie(client, DRAMA_ID)).resolves.toBeNull();
  });
});

describe('runTrashCleanup', () => {
  type QueryCall = { sql: string };

  const CUTOFF = { rows: [{ cutoff: new Date('2026-01-01T00:00:00.000Z') }], rowCount: 1 };

  function fakeClient(calls: QueryCall[], handlers: { match: string; result: unknown }[]) {
    return {
      connect: async () => {},
      query: async (sql: string) => {
        calls.push({ sql });

        for (const handler of handlers) {
          if (sql.includes(handler.match)) {
            return handler.result as { rows: unknown[]; rowCount: number };
          }
        }

        return { rows: [], rowCount: 0 };
      },
      end: async () => {},
    };
  }

  it('cleans one candidate inside a transaction and commits it', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      { match: 'as cutoff', result: CUTOFF },
      { match: 'select id, title from episodes', result: { rows: [{ id: EPISODE_ID, title: 'Episode' }], rowCount: 1 } },
      { match: 'select id, title from seasons', result: { rows: [], rowCount: 0 } },
      { match: 'select id, title from movies', result: { rows: [], rowCount: 0 } },
      { match: 'select id, title from dramas', result: { rows: [], rowCount: 0 } },
      { match: 'for update', result: { rows: [{ id: EPISODE_ID }], rowCount: 1 } },
    ]);

    const report = await runTrashCleanup({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      retentionDays: 30,
      batchSize: 10,
      dryRun: false,
      log: () => {},
    });

    const statements = calls.map(call => call.sql);

    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
    expect(report.removed).toHaveLength(1);
    expect(report.failures).toHaveLength(0);
  });

  it('rolls the candidate back when a statement fails', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      { match: 'as cutoff', result: CUTOFF },
      { match: 'select id, title from episodes', result: { rows: [{ id: EPISODE_ID, title: 'Episode' }], rowCount: 1 } },
      { match: 'select id, title from seasons', result: { rows: [], rowCount: 0 } },
      { match: 'select id, title from movies', result: { rows: [], rowCount: 0 } },
      { match: 'select id, title from dramas', result: { rows: [], rowCount: 0 } },
      { match: 'for update', result: { rows: [{ id: EPISODE_ID }], rowCount: 1 } },
    ]);

    const originalQuery = client.query;

    client.query = async (sql: string) => {
      if (sql.includes('delete from playback_progress')) {
        throw new Error('foreign key violation');
      }

      return originalQuery(sql);
    };

    const report = await runTrashCleanup({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      retentionDays: 30,
      batchSize: 10,
      dryRun: false,
      log: () => {},
    });

    const statements = calls.map(call => call.sql);

    expect(statements).toContain('BEGIN');
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(report.removed).toHaveLength(0);
    expect(report.failures).toHaveLength(1);
  });

  it('skips a drama whose provenance is kept by a converted movie', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      { match: 'as cutoff', result: CUTOFF },
      { match: 'select id, title from episodes', result: { rows: [], rowCount: 0 } },
      { match: 'select id, title from seasons', result: { rows: [], rowCount: 0 } },
      { match: 'select id, title from movies', result: { rows: [], rowCount: 0 } },
      { match: 'select id, title from dramas', result: { rows: [{ id: DRAMA_ID, title: 'Drama' }], rowCount: 1 } },
      { match: 'select title from movies', result: { rows: [{ title: 'Converted Movie' }], rowCount: 1 } },
    ]);

    const report = await runTrashCleanup({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      retentionDays: 30,
      batchSize: 10,
      dryRun: false,
      log: () => {},
    });

    expect(report.removed).toHaveLength(0);
    expect(report.skipped[0]?.reason).toContain('Converted Movie');
    expect(calls.map(call => call.sql)).not.toContain('BEGIN');
  });
});

describe('createLogger', () => {
  it('writes one JSON object per line', () => {
    const lines: string[] = [];
    const log = createLogger(line => lines.push(line));

    log('trash_cleanup.started', { retentionDays: 30 });

    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0] as string) as {
      event: string;
      retentionDays: number;
      timestamp: string;
    };

    expect(parsed.event).toBe('trash_cleanup.started');
    expect(parsed.retentionDays).toBe(30);
    expect(typeof parsed.timestamp).toBe('string');
  });
});
