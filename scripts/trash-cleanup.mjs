/**
 * Trash expiry cleanup command.
 *
 * A short-lived maintenance command: it runs once, removes the content whose
 * retention period has elapsed, writes a structured report, and exits. It is
 * not a worker and it does not schedule itself; the systemd timer starts it.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/trash-cleanup.mjs
 *   npm run db:trash:cleanup
 *
 * Environment:
 *   DATABASE_URL             required; the database the cleanup runs against.
 *   TRASH_RETENTION_DAYS     optional; retention period in days (default 30).
 *   TRASH_CLEANUP_BATCH_SIZE optional; rows removed per content type (default 100).
 *   TRASH_CLEANUP_DRY_RUN    optional; `1` reports what would be deleted and writes nothing.
 *
 * Protection rules:
 *   - Only rows whose `deleted_at` is older than the retention period are
 *     selected. Active content has no `deleted_at` and is never touched.
 *   - Content that was restored has its `deleted_at` cleared, so it is never
 *     selected. If it is trashed again, the retention clock starts over.
 *   - A parent is only removed when its whole hierarchy has expired as well, so
 *     no child is discarded before its own retention period ends.
 *   - Every candidate is cleaned in its own transaction, so a failure never
 *     leaves the dependent records deleted while the content row survives.
 *   - The row is locked with `FOR UPDATE` and re-checked inside that
 *     transaction, so a restoration that runs at the same time cannot be
 *     followed by the deletion of restored content.
 *   - A drama that was converted into a movie is skipped: the movie keeps
 *     permanent provenance, so the source cannot be removed.
 *
 * Cleanup rules match the permanent deletion rules of the admin surface:
 *   - Bookmarks, playback progress, watched state, and watch history are removed.
 *   - Ratings and reviews are retained for aggregate analytics, but the author
 *     identity and the content target are removed.
 *   - Analytics events, notifications, and content metadata rows are removed.
 *
 * The logs are JSON lines so a systemd journal can be filtered and counted
 * without parsing prose.
 */

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { Client } from 'pg';

/** Default retention period in days. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Default number of rows removed per content type in one run. */
export const DEFAULT_BATCH_SIZE = 100;

/** Upper bound on the batch size, so a misconfigured value cannot unload the database. */
export const MAX_BATCH_SIZE = 1000;

/** The content types the cleanup removes, in dependency order. */
export const CLEANUP_ORDER = ['episode', 'season', 'movie', 'drama'];

/** The table each content type lives in. */
export const TABLE_BY_CONTENT_TYPE = Object.freeze({
  drama: 'dramas',
  season: 'seasons',
  episode: 'episodes',
  movie: 'movies',
});

/**
 * Load `.env.local` tolerating the encoding it is stored in.
 *
 * The file is read but never overrides a real environment variable, so CI and
 * production are unaffected.
 */
export function loadLocalEnv(cwd = process.cwd()) {
  const envPath = `${cwd}/.env.local`;

  if (!existsSync(envPath)) {
    return;
  }

  const contents = readFileSync(envPath);
  let text;

  if (contents.length >= 2 && contents[0] === 0xff && contents[1] === 0xfe) {
    text = contents.subarray(2).toString('utf16le');
  } else if (contents.length >= 2 && contents[0] === 0xfe && contents[1] === 0xff) {
    const body = Buffer.from(contents.subarray(2));
    if (body.length % 2 === 0) {
      body.swap16();
    }
    text = body.toString('utf16le');
  } else {
    text = contents.toString('utf8').replace(/^\uFEFF/, '');
  }

  for (const [key, value] of Object.entries(parse(text))) {
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

/** Parse a positive integer environment value, falling back to the default. */
export function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

/**
 * One removed row, reported in the run summary.
 *
 * @typedef {object} CleanupEntry
 * @property {string} contentType
 * @property {string} id
 * @property {string | null} title
 * @property {Record<string, number>} removed
 */

/**
 * The outcome of one cleanup run.
 *
 * @typedef {object} CleanupReport
 * @property {string} startedAt
 * @property {string} finishedAt
 * @property {number} retentionDays
 * @property {number} batchSize
 * @property {boolean} dryRun
 * @property {CleanupEntry[]} removed
 * @property {{ contentType: string, id: string, reason: string }[]} skipped
 * @property {{ contentType: string, id: string | null, message: string }[]} failures
 */

/** Structured logger: one JSON object per line. */
export function createLogger(write = line => console.log(line)) {
  return function log(event, payload = {}) {
    write(JSON.stringify({ timestamp: new Date().toISOString(), event, ...payload }));
  };
}

/** Escape a value for a literal SQL string. */
export function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * The statements that remove one expired row and everything that points at it.
 *
 * The statements run in the order the foreign keys demand: the personal
 * records first, then the detached ratings and reviews, then the metadata,
 * then the hierarchy from the leaves up, and finally the content row itself.
 *
 * `episodeIds` and `seasonIds` are the *children* the row takes with it; the
 * row itself is removed by the statement that matches its own content type.
 */
export function buildCleanupStatements(input) {
  const { contentType, id, episodeIds = [], seasonIds = [] } = input;

  const episodeList = episodeIds.length > 0 ? episodeIds.map(quote).join(', ') : null;
  const seasonList = seasonIds.length > 0 ? seasonIds.map(quote).join(', ') : null;
  const episodeCondition = episodeList ? `episode_id in (${episodeList})` : 'false';
  // Legacy personal records only carry the `content_type`/`content_id` pair, so
  // they are matched as well as the typed target columns.
  const legacyCondition = `content_type = ${quote(contentType)} and content_id = ${quote(id)}`;

  const statements = [];

  if (contentType === 'drama' || contentType === 'movie') {
    const targetColumn = contentType === 'drama' ? 'drama_id' : 'movie_id';

    statements.push(
      {
        key: 'bookmarks',
        counter: 'bookmarks',
        kind: 'delete',
        sql: `delete from bookmarks where ${targetColumn} = ${quote(id)} or (content_type = ${quote(contentType)} and content_id = ${quote(id)})`,
      },
      {
        key: 'playbackProgress',
        counter: 'playbackProgress',
        kind: 'delete',
        sql: `delete from playback_progress where ${targetColumn} = ${quote(id)} or ${legacyCondition} or ${episodeCondition}`,
      },
      {
        key: 'watchedState',
        counter: 'watchedState',
        kind: 'delete',
        sql: `delete from watched_state where ${targetColumn} = ${quote(id)} or ${legacyCondition} or ${episodeCondition}`,
      },
      {
        key: 'watchHistory',
        counter: 'watchHistory',
        kind: 'delete',
        sql: `delete from watch_history where ${targetColumn} = ${quote(id)} or ${legacyCondition} or ${episodeCondition}`,
      },
      {
        key: 'contentViewEvents',
        counter: 'analyticsEvents',
        kind: 'delete',
        sql: `delete from content_view_events where ${targetColumn} = ${quote(id)}`,
      },
      {
        key: 'playbackAnalyticsEvents',
        counter: 'analyticsEvents',
        kind: 'delete',
        sql: `delete from playback_analytics_events where ${targetColumn} = ${quote(id)}`,
      },
      {
        key: 'analyticsDailyAggregates',
        counter: 'analyticsEvents',
        kind: 'delete',
        sql: `delete from analytics_daily_aggregates where ${targetColumn} = ${quote(id)}`,
      },
      {
        key: 'notifications',
        counter: 'notifications',
        kind: 'delete',
        sql: `delete from notifications where content_type = ${quote(contentType)} and content_id = ${quote(id)}`,
      },
      {
        key: 'adminNotifications',
        counter: 'notifications',
        kind: 'delete',
        sql: `delete from admin_notifications where content_type = ${quote(contentType)} and content_id = ${quote(id)}`,
      },
      // The ratings and reviews are retained for aggregate analytics; only the
      // author identity and the content target are removed.
      {
        key: 'ratings',
        counter: 'ratings',
        kind: 'update',
        sql: `update ratings set user_id = null, anonymized_at = now(), ${targetColumn} = null where ${targetColumn} = ${quote(id)}`,
      },
      {
        key: 'reviews',
        counter: 'reviews',
        kind: 'update',
        sql: `update reviews set user_id = null, anonymized_at = now(), ${targetColumn} = null where ${targetColumn} = ${quote(id)}`,
      },
      {
        key: 'contentSlugHistory',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from content_slug_history where content_type = ${quote(contentType)} and content_id = ${quote(id)}`,
      },
      {
        key: 'contentSeo',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from content_seo where content_type = ${quote(contentType)} and content_id = ${quote(id)}`,
      },
      {
        key: 'contentAssets',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from content_assets where content_type = ${quote(contentType)} and content_id = ${quote(id)}`,
      }
    );
  } else if (contentType === 'season' || contentType === 'episode') {
    const ownEpisodeId = contentType === 'episode' ? quote(id) : null;
    const condition =
      contentType === 'episode'
        ? `episode_id = ${ownEpisodeId}`
        : episodeList
          ? `episode_id in (${episodeList})`
          : 'false';

    statements.push(
      {
        key: 'playbackProgress',
        counter: 'playbackProgress',
        kind: 'delete',
        sql: `delete from playback_progress where ${condition}`,
      },
      {
        key: 'watchedState',
        counter: 'watchedState',
        kind: 'delete',
        sql: `delete from watched_state where ${condition}`,
      },
      {
        key: 'watchHistory',
        counter: 'watchHistory',
        kind: 'delete',
        sql: `delete from watch_history where ${condition}`,
      }
    );
  }

  if (contentType === 'drama') {
    statements.push(
      {
        key: 'similarDramas',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from similar_dramas where drama_id = ${quote(id)} or similar_drama_id = ${quote(id)}`,
      },
      {
        key: 'dramaCategories',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from drama_categories where drama_id = ${quote(id)}`,
      },
      {
        key: 'dramaPlatforms',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from drama_platforms where drama_id = ${quote(id)}`,
      },
      {
        key: 'conversionSnapshots',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from structure_conversion_snapshots where drama_id = ${quote(id)}`,
      }
    );
  }

  if (contentType === 'movie') {
    statements.push(
      {
        key: 'movieCategories',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from movie_categories where movie_id = ${quote(id)}`,
      },
      {
        key: 'moviePlatforms',
        counter: 'metadataRows',
        kind: 'delete',
        sql: `delete from movie_platforms where movie_id = ${quote(id)}`,
      }
    );
  }

  if (episodeList) {
    statements.push({
      key: 'episodes',
      counter: null,
      kind: 'delete',
      sql: `delete from episodes where id in (${episodeList}) and deleted_at is not null`,
    });
  }

  if (seasonList) {
    statements.push({
      key: 'seasons',
      counter: null,
      kind: 'delete',
      sql: `delete from seasons where id in (${seasonList}) and deleted_at is not null`,
    });
  }

  const targetTable = TABLE_BY_CONTENT_TYPE[contentType] ?? 'movies';

  statements.push({
    key: targetTable,
    counter: null,
    kind: 'delete',
    // The `deleted_at` guard is the last line of defence against a restore that
    // wins the race between the candidate selection and this delete.
    sql: `delete from ${targetTable} where id = ${quote(id)} and deleted_at is not null`,
  });

  return statements;
}

/** Count the rows a statement would remove. */
async function countAffected(client, statement) {
  if (statement.kind === 'delete') {
    const match = statement.sql.match(/^delete from (\w+)/i);

    if (!match) {
      return 0;
    }

    const table = match[1];
    const where = statement.sql.slice(statement.sql.indexOf('where') + 5).trim();
    const result = await client.query(`select count(*)::int as total from ${table} where ${where}`);

    return Number(result.rows[0]?.total ?? 0);
  }

  const match = statement.sql.match(/^update (\w+) set /i);

  if (!match) {
    return 0;
  }

  const table = match[1];
  const where = statement.sql.slice(statement.sql.indexOf(' where ') + 7).trim();
  const result = await client.query(`select count(*)::int as total from ${table} where ${where}`);

  return Number(result.rows[0]?.total ?? 0);
}

/**
 * Resolve the hierarchy a row takes with it.
 *
 * A drama takes its seasons and episodes, a season takes its episodes, and an
 * episode and a movie take only themselves. Children that have not expired yet
 * are counted so the parent is not removed before them.
 */
export async function resolveScope(client, contentType, id, cutoff) {
  const episodeIds = [];
  const seasonIds = [];
  let notExpiredChildren = 0;

  if (contentType === 'drama') {
    const seasons = await client.query(`select id from seasons where drama_id = $1`, [id]);
    const episodes = await client.query(`select id from episodes where drama_id = $1`, [id]);

    for (const row of seasons.rows) {
      seasonIds.push(row.id);
    }

    for (const row of episodes.rows) {
      episodeIds.push(row.id);
    }

    const seasonsNotExpired = await client.query(
      `select count(*)::int as total from seasons where drama_id = $1 and (deleted_at is null or deleted_at >= $2)`,
      [id, cutoff]
    );
    const episodesNotExpired = await client.query(
      `select count(*)::int as total from episodes where drama_id = $1 and (deleted_at is null or deleted_at >= $2)`,
      [id, cutoff]
    );

    notExpiredChildren =
      Number(seasonsNotExpired.rows[0]?.total ?? 0) + Number(episodesNotExpired.rows[0]?.total ?? 0);
  } else if (contentType === 'season') {
    const episodes = await client.query(`select id from episodes where season_id = $1`, [id]);

    for (const row of episodes.rows) {
      episodeIds.push(row.id);
    }

    const episodesNotExpired = await client.query(
      `select count(*)::int as total from episodes where season_id = $1 and (deleted_at is null or deleted_at >= $2)`,
      [id, cutoff]
    );

    notExpiredChildren = Number(episodesNotExpired.rows[0]?.total ?? 0);
  }

  return { episodeIds, seasonIds, notExpiredChildren };
}

/**
 * The part of the PostgreSQL client the command actually uses.
 *
 * The command is deliberately written against this narrow shape instead of the
 * whole `pg` client, so the test suite can drive it with a small fake.
 *
 * @typedef {object} PgQueryClient
 * @property {(sql: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number | null }>} query
 */

/**
 * Lock one expired row and confirm it is still in the Trash.
 *
 * The row lock is taken with `FOR UPDATE`, which conflicts with the row lock
 * the restoration workflow takes. A restoration that is already in flight
 * therefore finishes before the cleanup proceeds, and a restoration that
 * starts afterwards waits for the cleanup to finish. The `deleted_at` check
 * then decides whether the row is still eligible.
 *
 * @param {PgQueryClient} client
 * @param {string} contentType
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function lockExpiredRow(client, contentType, id) {
  const table = TABLE_BY_CONTENT_TYPE[contentType] ?? 'movies';

  const result = await client.query(
    `select id from ${table} where id = $1 and deleted_at is not null for update`,
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Find the movie that a drama was converted into.
 *
 * Provenance is permanent (D-030): the movie keeps a foreign key to its source
 * drama, so the source cannot be removed while the movie exists. The cleanup
 * skips such a drama instead of failing on the foreign key.
 *
 * @param {PgQueryClient} client
 * @param {string} dramaId
 * @returns {Promise<string | null>} the title of the converted movie
 */
export async function findConvertedMovie(client, dramaId) {
  const result = await client.query(
    `select title from movies where converted_from_drama_id = $1 limit 1`,
    [dramaId]
  );

  return result.rows[0]?.title ?? null;
}

/**
 * Run the cleanup.
 *
 * The function is exported so the test suite can drive it against the test
 * database; the command line entry point is added at the bottom of the file.
 */
export async function runTrashCleanup(options = {}) {
  const {
    connectionString = process.env.DATABASE_URL,
    // An injected client makes the transaction behaviour testable without a
    // database. The command line entry point never passes one.
    client: providedClient,
    retentionDays = parsePositiveInteger(
      process.env.TRASH_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
      365
    ),
    batchSize = parsePositiveInteger(
      process.env.TRASH_CLEANUP_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      MAX_BATCH_SIZE
    ),
    dryRun = process.env.TRASH_CLEANUP_DRY_RUN === '1',
    log = createLogger(),
  } = options;

  const startedAt = new Date().toISOString();
  /** @type {CleanupReport} */
  const report = {
    startedAt,
    finishedAt: startedAt,
    retentionDays,
    batchSize,
    dryRun,
    removed: [],
    skipped: [],
    failures: [],
  };

  if (!connectionString) {
    log('trash_cleanup.failed', { reason: 'missing_database_url' });
    report.failures.push({ contentType: 'database', id: null, message: 'DATABASE_URL is not set.' });
    report.finishedAt = new Date().toISOString();
    return report;
  }

  const client = providedClient ?? new Client({ connectionString });
  const ownsClient = providedClient === undefined;

  try {
    await client.connect();

    const cutoffResult = await client.query(
      `select (now() - ($1::int * interval '1 day')) as cutoff`,
      [retentionDays]
    );
    const cutoff = cutoffResult.rows[0]?.cutoff;

    log('trash_cleanup.started', {
      retentionDays,
      batchSize,
      dryRun,
      cutoff: cutoff instanceof Date ? cutoff.toISOString() : String(cutoff),
    });

    for (const contentType of CLEANUP_ORDER) {
      const table = TABLE_BY_CONTENT_TYPE[contentType] ?? 'movies';
      const candidates = await client.query(
        `select id, title from ${table} where deleted_at is not null and deleted_at < $1 order by deleted_at asc limit $2`,
        [cutoff, batchSize]
      );

      for (const candidate of candidates.rows) {
        try {
          const scope = await resolveScope(client, contentType, candidate.id, cutoff);

          if (scope.notExpiredChildren > 0) {
            report.skipped.push({
              contentType,
              id: candidate.id,
              reason: `child content is not expired yet (${scope.notExpiredChildren} record(s))`,
            });
            log('trash_cleanup.skipped', {
              contentType,
              id: candidate.id,
              reason: 'child_not_expired',
              childCount: scope.notExpiredChildren,
            });
            continue;
          }

          if (contentType === 'drama') {
            const convertedTitle = await findConvertedMovie(client, candidate.id);

            if (convertedTitle !== null) {
              report.skipped.push({
                contentType,
                id: candidate.id,
                reason: `the drama was converted into the movie "${convertedTitle}", which keeps its provenance`,
              });
              log('trash_cleanup.skipped', {
                contentType,
                id: candidate.id,
                reason: 'converted_to_movie',
              });
              continue;
            }
          }

          const statements = buildCleanupStatements({
            contentType,
            id: candidate.id,
            episodeIds: scope.episodeIds,
            seasonIds: scope.seasonIds,
          });

          const removed = {
            bookmarks: 0,
            playbackProgress: 0,
            watchedState: 0,
            watchHistory: 0,
            ratings: 0,
            reviews: 0,
            analyticsEvents: 0,
            notifications: 0,
            metadataRows: 0,
            episodes: scope.episodeIds.length + (contentType === 'episode' ? 1 : 0),
            seasons: scope.seasonIds.length + (contentType === 'season' ? 1 : 0),
          };

          // Every candidate is cleaned in its own transaction, so a failure
          // never leaves the dependent records deleted while the content row
          // survives.
          if (!dryRun) {
            await client.query('BEGIN');
          }

          try {
            if (!dryRun) {
              const locked = await lockExpiredRow(client, contentType, candidate.id);

              if (!locked) {
                await client.query('ROLLBACK');
                report.skipped.push({
                  contentType,
                  id: candidate.id,
                  reason: 'the content was restored before the cleanup locked it',
                });
                log('trash_cleanup.skipped', {
                  contentType,
                  id: candidate.id,
                  reason: 'restored_concurrently',
                });
                continue;
              }
            }

            for (const statement of statements) {
              if (dryRun) {
                const affected = await countAffected(client, statement);

                if (statement.counter) {
                  removed[statement.counter] = (removed[statement.counter] ?? 0) + affected;
                }

                continue;
              }

              const result = await client.query(statement.sql);

              if (statement.counter) {
                removed[statement.counter] = (removed[statement.counter] ?? 0) + (result.rowCount ?? 0);
              }
            }

            if (!dryRun) {
              await client.query('COMMIT');
            }
          } catch (statementError) {
            if (!dryRun) {
              await client.query('ROLLBACK').catch(() => {});
            }

            throw statementError;
          }

          report.removed.push({
            contentType,
            id: candidate.id,
            title: candidate.title ?? null,
            removed,
          });

          log('trash_cleanup.removed', {
            contentType,
            id: candidate.id,
            title: candidate.title ?? null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report.failures.push({ contentType, id: candidate.id, message });
          log('trash_cleanup.failed', { contentType, id: candidate.id, message });
        }
      }
    }

    report.finishedAt = new Date().toISOString();

    log('trash_cleanup.finished', {
      removed: report.removed.length,
      skipped: report.skipped.length,
      failed: report.failures.length,
      durationMs: Date.parse(report.finishedAt) - Date.parse(startedAt),
    });

    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.failures.push({ contentType: 'database', id: null, message });
    report.finishedAt = new Date().toISOString();
    log('trash_cleanup.failed', { reason: 'fatal', message });
    return report;
  } finally {
    if (ownsClient) {
      await client.end();
    }
  }
}

/** Command line entry point. */
async function main() {
  loadLocalEnv();

  const report = await runTrashCleanup();

  if (report.failures.length > 0) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch(error => {
    createLogger()('trash_cleanup.failed', {
      reason: 'unhandled',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
