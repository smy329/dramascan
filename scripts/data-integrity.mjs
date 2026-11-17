/**
 * Data-integrity operator command for the Phase 4 typed-relationship work
 * (H-08, H-09, M-07).
 *
 * There is deliberately no shebang: the command is invoked through
 * `npm run db:integrity`, and a shebang in a file that Git checks out with
 * CRLF line endings breaks the Vite transform that the integration test uses
 * to import this module.
 *
 * Three subcommands, all safe to re-run:
 *
 *   report    Read-only. Prints every row that the new constraints or unique
 *             indexes cannot accept yet, plus the constraints that are still
 *             `NOT VALID`. It never writes.
 *   backfill  Idempotent. Gives legacy user-content rows their typed
 *             `drama_id`/`movie_id` target, but only where the answer is
 *             unambiguous: the legacy `content_type` names the table, the id
 *             exists there, and it does not also exist in the other table.
 *             Ambiguous rows are left untouched for a human decision.
 *   validate  Explicit gate. Validates the `NOT VALID` constraints and retries
 *             the unique indexes that the migration had to skip. Every failure
 *             is reported and the exit code is non-zero.
 *
 * The legacy `content_type`/`content_id` columns are never dropped or rewritten:
 * they are the only evidence still available for rows the backfill cannot place.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parse } from 'dotenv';
import { Client } from 'pg';

/** Tables that gained typed drama/movie targets in migration 0009. */
export const USER_CONTENT_TABLES = [
  'bookmarks',
  'playback_progress',
  'watched_state',
  'watch_history',
];

/**
 * Tables that gained typed drama/movie targets in migration 0010.
 *
 * The two event tables always name one content item. The daily aggregate may
 * be site-wide, so a row without a content id keeps no typed target.
 */
export const ANALYTICS_TABLES = [
  'content_view_events',
  'playback_analytics_events',
  'analytics_daily_aggregates',
];

/**
 * Idempotent backfill statements.
 *
 * Each statement only touches rows that still have no typed target, so running
 * the backfill twice is a no-op. `NOT EXISTS` in the other table is what makes a
 * row "ambiguous" rather than guessed: an id that exists in both `dramas` and
 * `movies` cannot be resolved from the legacy pair alone.
 *
 * Every statement writes at most `BACKFILL_BATCH_SIZE` rows per transaction.
 * A backfill on a large table must not hold one lock over the whole table, and
 * a batch that fails leaves the rest of the work for the next run — the
 * statement is idempotent, so the next run continues where this one stopped.
 */
export const BACKFILL_BATCH_SIZE = 500;

export const BACKFILL_STATEMENTS = [...USER_CONTENT_TABLES, ...ANALYTICS_TABLES].flatMap(table => [
  {
    table,
    type: 'drama',
    column: 'drama_id',
    sql: `WITH batch AS (
            SELECT id FROM ${table}
             WHERE drama_id IS NULL
               AND movie_id IS NULL
               AND content_type = 'drama'
               AND EXISTS (SELECT 1 FROM dramas d WHERE d.id = ${table}.content_id)
               AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = ${table}.content_id)
               AND NOT (id = ANY($1::uuid[]))
             ORDER BY id
             LIMIT $2
          )
          UPDATE ${table} AS t
             SET drama_id = t.content_id
            FROM batch
           WHERE t.id = batch.id`,
  },
  {
    table,
    type: 'movie',
    column: 'movie_id',
    sql: `WITH batch AS (
            SELECT id FROM ${table}
             WHERE drama_id IS NULL
               AND movie_id IS NULL
               AND content_type = 'movie'
               AND EXISTS (SELECT 1 FROM movies m WHERE m.id = ${table}.content_id)
               AND NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = ${table}.content_id)
               AND NOT (id = ANY($1::uuid[]))
             ORDER BY id
             LIMIT $2
          )
          UPDATE ${table} AS t
             SET movie_id = t.content_id
            FROM batch
           WHERE t.id = batch.id`,
  },
]);

/**
 * The unique keys the backfill can fill.
 *
 * Backfilling a row gives it a typed target, and the per-user/per-target unique
 * indexes may already hold that key: either because another legacy row of the
 * same user points at the same content, or because a row written after the
 * migration already carries that typed target. Such a row cannot be updated
 * without violating the index, so it is left untouched and reported instead.
 */
export const BACKFILL_UNIQUE_KEYS = [
  { table: 'bookmarks', column: 'drama_id' },
  { table: 'bookmarks', column: 'movie_id' },
  { table: 'playback_progress', column: 'movie_id' },
  { table: 'watched_state', column: 'movie_id' },
];

/** The tables whose rows name a user. */
const BACKFILL_USER_TABLES = ['bookmarks', 'playback_progress', 'watched_state', 'watch_history'];

/** The tables whose rows may name an episode. */
const BACKFILL_EPISODE_TABLES = ['playback_progress', 'watched_state', 'watch_history'];

function hasUniqueKey(table, column) {
  return BACKFILL_UNIQUE_KEYS.some(key => key.table === table && key.column === column);
}

/**
 * The rows the backfill must not place.
 *
 * A candidate row is one the backfill would place. It is blocked when the
 * update would be rejected:
 *
 *   * the target key it would occupy is already held — by a typed row of the
 *     same user, or by another legacy row of the same user that points at the
 *     same content (`target-already-typed`, `duplicate-legacy-row`);
 *   * one of its other foreign keys is broken, so the update would be
 *     rejected by it (`missing-user`, `missing-episode`).
 *
 * A blocked row is left untouched: the backfill must not abort on it, because
 * an abort would roll back the placements that did succeed.
 */
function blockedQuery(table, type) {
  const parent = type === 'drama' ? 'dramas' : 'movies';
  const other = type === 'drama' ? 'movies' : 'dramas';
  const uniqueColumn = type === 'drama' ? 'drama_id' : 'movie_id';
  const unique = hasUniqueKey(table, uniqueColumn);
  const hasUser = BACKFILL_USER_TABLES.includes(table);
  const hasEpisode = BACKFILL_EPISODE_TABLES.includes(table);

  const occupied = unique
    ? `EXISTS (
         SELECT 1 FROM ${table} held
          WHERE held.${uniqueColumn} IS NOT NULL
            AND held.user_id = c.user_id
            AND held.${uniqueColumn} = c.content_id
       )`
    : 'FALSE';
  const sibling = unique
    ? `EXISTS (
         SELECT 1 FROM ${table} twin
          WHERE twin.${uniqueColumn} IS NULL
            AND twin.drama_id IS NULL
            AND twin.movie_id IS NULL
            AND twin.content_type = '${type}'
            AND twin.user_id = c.user_id
            AND twin.content_id = c.content_id
            AND twin.id <> c.id
       )`
    : 'FALSE';
  const missingUser = hasUser
    ? 'NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)'
    : 'FALSE';
  const missingEpisode = hasEpisode
    ? '(c.episode_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.id = c.episode_id))'
    : 'FALSE';

  const reasons = [];

  if (unique) {
    reasons.push(`WHEN ${occupied} THEN 'target-already-typed'`);
    reasons.push(`WHEN ${sibling} THEN 'duplicate-legacy-row'`);
  }

  if (hasUser) {
    reasons.push(`WHEN ${missingUser} THEN 'missing-user'`);
  }

  if (hasEpisode) {
    reasons.push(`WHEN ${missingEpisode} THEN 'missing-episode'`);
  }

  const reasonExpression =
    reasons.length > 0 ? `CASE ${reasons.join(' ')} ELSE 'blocked' END` : `'blocked'`;

  return `SELECT '${table}' AS table_name,
                '${type}' AS target_type,
                c.id AS id,
                ${hasUser ? 'c.user_id' : 'NULL::uuid'} AS user_id,
                c.content_id AS target_id,
                ${reasonExpression} AS reason
           FROM ${table} c
          WHERE c.drama_id IS NULL
            AND c.movie_id IS NULL
            AND c.content_type = '${type}'
            AND EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = c.content_id)
            AND NOT EXISTS (SELECT 1 FROM ${other} o WHERE o.id = c.content_id)
            AND (${occupied} OR ${sibling} OR ${missingUser} OR ${missingEpisode})`;
}

export const BACKFILL_BLOCKED_SQL = `${[...USER_CONTENT_TABLES, ...ANALYTICS_TABLES]
  .flatMap(table => [blockedQuery(table, 'drama'), blockedQuery(table, 'movie')])
  .join('\nUNION ALL\n')} ORDER BY table_name, target_type, id`;

/**
 * The foreign keys whose parent row may be missing.
 *
 * The migration adds these constraints `NOT VALID`, so a legacy row may still
 * point at a parent that does not exist. Every one of them is reported: an
 * operator can only reconcile what the report names.
 *
 * The content hierarchy (`seasons.drama_id`, `episodes.drama_id`, and the
 * composite `episodes(drama_id, season_id)`) is reported by `hierarchy-orphans`
 * instead, because a cross-parent episode needs a different answer than a
 * missing parent.
 *
 * A join table has no id of its own, so its identity is the pair of its
 * endpoints.
 */
export const FOREIGN_KEY_TARGETS = [
  {
    table: 'drama_categories',
    column: 'drama_id',
    parent: 'dramas',
    identity: `t.drama_id::text || ':' || t.category_id::text`,
  },
  {
    table: 'drama_categories',
    column: 'category_id',
    parent: 'categories',
    identity: `t.drama_id::text || ':' || t.category_id::text`,
  },
  {
    table: 'drama_platforms',
    column: 'drama_id',
    parent: 'dramas',
    identity: `t.drama_id::text || ':' || t.platform_id::text`,
  },
  {
    table: 'drama_platforms',
    column: 'platform_id',
    parent: 'platforms',
    identity: `t.drama_id::text || ':' || t.platform_id::text`,
  },
  {
    table: 'movie_categories',
    column: 'movie_id',
    parent: 'movies',
    identity: `t.movie_id::text || ':' || t.category_id::text`,
  },
  {
    table: 'movie_categories',
    column: 'category_id',
    parent: 'categories',
    identity: `t.movie_id::text || ':' || t.category_id::text`,
  },
  {
    table: 'movie_platforms',
    column: 'movie_id',
    parent: 'movies',
    identity: `t.movie_id::text || ':' || t.platform_id::text`,
  },
  {
    table: 'movie_platforms',
    column: 'platform_id',
    parent: 'platforms',
    identity: `t.movie_id::text || ':' || t.platform_id::text`,
  },
  {
    table: 'similar_dramas',
    column: 'drama_id',
    parent: 'dramas',
    identity: `t.drama_id::text || ':' || t.similar_drama_id::text`,
  },
  {
    table: 'similar_dramas',
    column: 'similar_drama_id',
    parent: 'dramas',
    identity: `t.drama_id::text || ':' || t.similar_drama_id::text`,
  },
  {
    table: 'user_roles',
    column: 'user_id',
    parent: 'users',
    identity: `t.user_id::text || ':' || t.role_id::text`,
  },
  { table: 'review_reactions', column: 'user_id', parent: 'users' },
  { table: 'review_reactions', column: 'review_id', parent: 'reviews' },
  { table: 'review_reports', column: 'user_id', parent: 'users' },
  { table: 'review_reports', column: 'review_id', parent: 'reviews' },
  { table: 'review_reports', column: 'resolved_by', parent: 'users' },
  { table: 'bookmarks', column: 'user_id', parent: 'users' },
  { table: 'bookmarks', column: 'drama_id', parent: 'dramas' },
  { table: 'bookmarks', column: 'movie_id', parent: 'movies' },
  { table: 'playback_progress', column: 'user_id', parent: 'users' },
  { table: 'playback_progress', column: 'drama_id', parent: 'dramas' },
  { table: 'playback_progress', column: 'movie_id', parent: 'movies' },
  { table: 'playback_progress', column: 'episode_id', parent: 'episodes' },
  { table: 'watched_state', column: 'user_id', parent: 'users' },
  { table: 'watched_state', column: 'drama_id', parent: 'dramas' },
  { table: 'watched_state', column: 'movie_id', parent: 'movies' },
  { table: 'watched_state', column: 'episode_id', parent: 'episodes' },
  { table: 'watch_history', column: 'user_id', parent: 'users' },
  { table: 'watch_history', column: 'drama_id', parent: 'dramas' },
  { table: 'watch_history', column: 'movie_id', parent: 'movies' },
  { table: 'watch_history', column: 'episode_id', parent: 'episodes' },
  { table: 'content_view_events', column: 'drama_id', parent: 'dramas' },
  { table: 'content_view_events', column: 'movie_id', parent: 'movies' },
  { table: 'playback_analytics_events', column: 'drama_id', parent: 'dramas' },
  { table: 'playback_analytics_events', column: 'movie_id', parent: 'movies' },
  { table: 'analytics_daily_aggregates', column: 'drama_id', parent: 'dramas' },
  { table: 'analytics_daily_aggregates', column: 'movie_id', parent: 'movies' },
];

function foreignKeyOrphanQuery({ table, column, parent, identity }) {
  return `SELECT '${table}' AS table_name,
                '${column}' AS column_name,
                ${identity ?? 't.id::text'} AS id,
                t.${column}::text AS parent_id,
                '${parent}' AS parent_table
           FROM ${table} t
          WHERE t.${column} IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = t.${column})`;
}

export const FOREIGN_KEY_ORPHAN_SQL = `${FOREIGN_KEY_TARGETS.map(foreignKeyOrphanQuery).join(
  '\nUNION ALL\n'
)} ORDER BY table_name, column_name, id`;

/** Constraints added by migration 0009 in the `NOT VALID` posture. */
export const NOT_VALID_CONSTRAINTS = [
  ['seasons', 'fk_seasons_drama_id'],
  ['episodes', 'fk_episodes_drama_id'],
  ['episodes', 'fk_episodes_drama_id_season_id'],
  ['drama_categories', 'fk_drama_categories_drama_id'],
  ['drama_categories', 'fk_drama_categories_category_id'],
  ['drama_platforms', 'fk_drama_platforms_drama_id'],
  ['drama_platforms', 'fk_drama_platforms_platform_id'],
  ['movie_categories', 'fk_movie_categories_movie_id'],
  ['movie_categories', 'fk_movie_categories_category_id'],
  ['movie_platforms', 'fk_movie_platforms_movie_id'],
  ['movie_platforms', 'fk_movie_platforms_platform_id'],
  ['similar_dramas', 'fk_similar_dramas_drama_id'],
  ['similar_dramas', 'fk_similar_dramas_similar_drama_id'],
  ['user_roles', 'fk_user_roles_user_id'],
  ['review_reactions', 'fk_review_reactions_user_id'],
  ['review_reactions', 'fk_review_reactions_review_id'],
  ['review_reports', 'fk_review_reports_user_id'],
  ['review_reports', 'fk_review_reports_review_id'],
  ['bookmarks', 'fk_bookmarks_user_id'],
  ['bookmarks', 'fk_bookmarks_drama_id'],
  ['bookmarks', 'fk_bookmarks_movie_id'],
  ['playback_progress', 'fk_playback_progress_user_id'],
  ['playback_progress', 'fk_playback_progress_drama_id'],
  ['playback_progress', 'fk_playback_progress_movie_id'],
  ['playback_progress', 'fk_playback_progress_episode_id'],
  ['watched_state', 'fk_watched_state_user_id'],
  ['watched_state', 'fk_watched_state_drama_id'],
  ['watched_state', 'fk_watched_state_movie_id'],
  ['watched_state', 'fk_watched_state_episode_id'],
  ['watch_history', 'fk_watch_history_user_id'],
  ['watch_history', 'fk_watch_history_drama_id'],
  ['watch_history', 'fk_watch_history_movie_id'],
  ['watch_history', 'fk_watch_history_episode_id'],
  ['ratings', 'ck_ratings_value_range'],
  ['bookmarks', 'ck_bookmarks_target'],
  ['playback_progress', 'ck_playback_progress_target'],
  ['watched_state', 'ck_watched_state_target'],
  ['watch_history', 'ck_watch_history_target'],
  ['content_view_events', 'fk_content_view_events_drama_id'],
  ['content_view_events', 'fk_content_view_events_movie_id'],
  ['content_view_events', 'ck_content_view_events_target'],
  ['playback_analytics_events', 'fk_playback_analytics_events_drama_id'],
  ['playback_analytics_events', 'fk_playback_analytics_events_movie_id'],
  ['playback_analytics_events', 'ck_playback_analytics_events_target'],
  ['analytics_daily_aggregates', 'fk_analytics_daily_aggregates_drama_id'],
  ['analytics_daily_aggregates', 'fk_analytics_daily_aggregates_movie_id'],
  ['analytics_daily_aggregates', 'ck_analytics_daily_aggregates_target'],
  ['review_reports', 'fk_review_reports_resolved_by'],
  ['review_reports', 'ck_review_reports_lifecycle'],
];

/**
 * Unique indexes whose creation the migration has to guard.
 *
 * PostgreSQL has no `NOT VALID` for unique objects, so a duplicate that predates
 * the migration would abort it. The migration creates each index in its own
 * exception block and warns when it cannot; this list is the retry path once the
 * report has been reconciled.
 */
export const GUARDED_UNIQUE_INDEXES = [
  [
    'uq_dramas_slug_active',
    `CREATE UNIQUE INDEX "uq_dramas_slug_active" ON "dramas" USING btree ("slug") WHERE "dramas"."deleted_at" is null`,
  ],
  [
    'uq_categories_slug_active',
    `CREATE UNIQUE INDEX "uq_categories_slug_active" ON "categories" USING btree ("slug") WHERE "categories"."deleted_at" is null`,
  ],
  [
    'uq_platforms_slug_active',
    `CREATE UNIQUE INDEX "uq_platforms_slug_active" ON "platforms" USING btree ("slug") WHERE "platforms"."deleted_at" is null`,
  ],
  [
    'uq_episodes_drama_id_episode_number_active',
    `CREATE UNIQUE INDEX "uq_episodes_drama_id_episode_number_active" ON "episodes" USING btree ("drama_id","episode_number") WHERE "episodes"."deleted_at" is null and "episodes"."episode_number" is not null`,
  ],
  [
    'uq_seasons_drama_id_position_active',
    `CREATE UNIQUE INDEX "uq_seasons_drama_id_position_active" ON "seasons" USING btree ("drama_id","position") WHERE "seasons"."deleted_at" is null and "seasons"."position" is not null`,
  ],
  [
    'uq_review_reactions_user_id_review_id',
    `CREATE UNIQUE INDEX "uq_review_reactions_user_id_review_id" ON "review_reactions" USING btree ("user_id","review_id")`,
  ],
  [
    'uq_review_reports_user_id_review_id_active',
    `CREATE UNIQUE INDEX "uq_review_reports_user_id_review_id_active" ON "review_reports" USING btree ("user_id","review_id") WHERE "review_reports"."status" = 'active'`,
  ],
  [
    'uq_bookmarks_user_id_drama_id',
    `CREATE UNIQUE INDEX "uq_bookmarks_user_id_drama_id" ON "bookmarks" USING btree ("user_id","drama_id") WHERE "bookmarks"."drama_id" is not null`,
  ],
  [
    'uq_bookmarks_user_id_movie_id',
    `CREATE UNIQUE INDEX "uq_bookmarks_user_id_movie_id" ON "bookmarks" USING btree ("user_id","movie_id") WHERE "bookmarks"."movie_id" is not null`,
  ],
  [
    'uq_playback_progress_user_id_episode_id',
    `CREATE UNIQUE INDEX "uq_playback_progress_user_id_episode_id" ON "playback_progress" USING btree ("user_id","episode_id") WHERE "playback_progress"."episode_id" is not null`,
  ],
  [
    'uq_playback_progress_user_id_movie_id',
    `CREATE UNIQUE INDEX "uq_playback_progress_user_id_movie_id" ON "playback_progress" USING btree ("user_id","movie_id") WHERE "playback_progress"."movie_id" is not null`,
  ],
  [
    'uq_watched_state_user_id_episode_id',
    `CREATE UNIQUE INDEX "uq_watched_state_user_id_episode_id" ON "watched_state" USING btree ("user_id","episode_id") WHERE "watched_state"."episode_id" is not null`,
  ],
  [
    'uq_watched_state_user_id_movie_id',
    `CREATE UNIQUE INDEX "uq_watched_state_user_id_movie_id" ON "watched_state" USING btree ("user_id","movie_id") WHERE "watched_state"."movie_id" is not null`,
  ],
];

/**
 * Report sections. Every entry is read-only: the `sql` is a plain SELECT and the
 * command never issues DDL or DML in `report` mode.
 */
export const REPORT_SECTIONS = [
  {
    key: 'user-content-without-typed-target',
    description:
      'Legacy user-content rows with no typed drama/movie target. The backfill places only unambiguous rows.',
    sql: `SELECT table_name, content_type, count(*)::bigint AS rows
            FROM (
              SELECT 'bookmarks' AS table_name, content_type FROM bookmarks WHERE drama_id IS NULL AND movie_id IS NULL
              UNION ALL
              SELECT 'playback_progress', content_type FROM playback_progress WHERE drama_id IS NULL AND movie_id IS NULL
              UNION ALL
              SELECT 'watched_state', content_type FROM watched_state WHERE drama_id IS NULL AND movie_id IS NULL
              UNION ALL
              SELECT 'watch_history', content_type FROM watch_history WHERE drama_id IS NULL AND movie_id IS NULL
            ) AS unresolved
           GROUP BY table_name, content_type
           ORDER BY table_name, content_type`,
  },
  {
    key: 'user-content-unresolvable-legacy-pair',
    description:
      'Rows whose legacy target id matches no row, or matches both a drama and a movie. These need an explicit decision; they are never guessed.',
    sql: `SELECT 'bookmarks' AS table_name, id, content_type, content_id
            FROM bookmarks WHERE drama_id IS NULL AND movie_id IS NULL
                                   AND content_type IN ('drama', 'movie')
                                   AND ((content_type = 'drama' AND NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = bookmarks.content_id))
                                     OR (content_type = 'movie' AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = bookmarks.content_id))
                                     OR (EXISTS (SELECT 1 FROM dramas d WHERE d.id = bookmarks.content_id)
                                         AND EXISTS (SELECT 1 FROM movies m WHERE m.id = bookmarks.content_id)))
          UNION ALL
          SELECT 'playback_progress', id, content_type, content_id
            FROM playback_progress WHERE drama_id IS NULL AND movie_id IS NULL
                                   AND content_type IN ('drama', 'movie')
                                   AND ((content_type = 'drama' AND NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = playback_progress.content_id))
                                     OR (content_type = 'movie' AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = playback_progress.content_id))
                                     OR (EXISTS (SELECT 1 FROM dramas d WHERE d.id = playback_progress.content_id)
                                         AND EXISTS (SELECT 1 FROM movies m WHERE m.id = playback_progress.content_id)))
          UNION ALL
          SELECT 'watched_state', id, content_type, content_id
            FROM watched_state WHERE drama_id IS NULL AND movie_id IS NULL
                                   AND content_type IN ('drama', 'movie')
                                   AND ((content_type = 'drama' AND NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = watched_state.content_id))
                                     OR (content_type = 'movie' AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = watched_state.content_id))
                                     OR (EXISTS (SELECT 1 FROM dramas d WHERE d.id = watched_state.content_id)
                                         AND EXISTS (SELECT 1 FROM movies m WHERE m.id = watched_state.content_id)))
          UNION ALL
          SELECT 'watch_history', id, content_type, content_id
            FROM watch_history WHERE drama_id IS NULL AND movie_id IS NULL
                                   AND content_type IN ('drama', 'movie')
                                   AND ((content_type = 'drama' AND NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = watch_history.content_id))
                                     OR (content_type = 'movie' AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = watch_history.content_id))
                                     OR (EXISTS (SELECT 1 FROM dramas d WHERE d.id = watch_history.content_id)
                                         AND EXISTS (SELECT 1 FROM movies m WHERE m.id = watch_history.content_id)))`,
  },
  {
    key: 'analytics-without-typed-target',
    description:
      'Analytics rows with no typed drama/movie target. The backfill places only unambiguous rows; a site-wide daily aggregate legitimately has no target.',
    sql: `SELECT table_name, content_type, count(*)::bigint AS rows
            FROM (
              SELECT 'content_view_events' AS table_name, content_type FROM content_view_events WHERE drama_id IS NULL AND movie_id IS NULL
              UNION ALL
              SELECT 'playback_analytics_events', content_type FROM playback_analytics_events WHERE drama_id IS NULL AND movie_id IS NULL
              UNION ALL
              SELECT 'analytics_daily_aggregates', content_type FROM analytics_daily_aggregates WHERE drama_id IS NULL AND movie_id IS NULL AND content_id IS NOT NULL
            ) AS unresolved
           GROUP BY table_name, content_type
           ORDER BY table_name, content_type`,
  },
  {
    key: 'analytics-unresolvable-legacy-pair',
    description:
      'Analytics rows whose legacy target id matches no row, or matches both a drama and a movie. These need an explicit decision; they are never guessed.',
    sql: `SELECT 'content_view_events' AS table_name, id, content_type, content_id
            FROM content_view_events WHERE drama_id IS NULL AND movie_id IS NULL
                                   AND content_type IN ('drama', 'movie')
                                   AND ((content_type = 'drama' AND NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = content_view_events.content_id))
                                     OR (content_type = 'movie' AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = content_view_events.content_id))
                                     OR (EXISTS (SELECT 1 FROM dramas d WHERE d.id = content_view_events.content_id)
                                         AND EXISTS (SELECT 1 FROM movies m WHERE m.id = content_view_events.content_id)))
          UNION ALL
          SELECT 'playback_analytics_events', id, content_type, content_id
            FROM playback_analytics_events WHERE drama_id IS NULL AND movie_id IS NULL
                                   AND content_type IN ('drama', 'movie')
                                   AND ((content_type = 'drama' AND NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = playback_analytics_events.content_id))
                                     OR (content_type = 'movie' AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = playback_analytics_events.content_id))
                                     OR (EXISTS (SELECT 1 FROM dramas d WHERE d.id = playback_analytics_events.content_id)
                                         AND EXISTS (SELECT 1 FROM movies m WHERE m.id = playback_analytics_events.content_id)))
          UNION ALL
          SELECT 'analytics_daily_aggregates', id, content_type, content_id
            FROM analytics_daily_aggregates WHERE drama_id IS NULL AND movie_id IS NULL
                                   AND content_id IS NOT NULL
                                   AND content_type IN ('drama', 'movie')
                                   AND ((content_type = 'drama' AND NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = analytics_daily_aggregates.content_id))
                                     OR (content_type = 'movie' AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = analytics_daily_aggregates.content_id))
                                     OR (EXISTS (SELECT 1 FROM dramas d WHERE d.id = analytics_daily_aggregates.content_id)
                                         AND EXISTS (SELECT 1 FROM movies m WHERE m.id = analytics_daily_aggregates.content_id)))`,
  },
  {
    key: 'legacy-reports-without-reported-at',
    description:
      'Review reports whose submission time is unknown. The column was added after these rows existed, and their real submission time cannot be reconstructed.',
    sql: `SELECT id, user_id, review_id, reason, status
            FROM review_reports
           WHERE reported_at IS NULL
           ORDER BY id`,
  },
  {
    key: 'report-lifecycle-violations',
    description:
      'Review reports whose resolution record does not match their status: an active report carrying a resolution, or a resolved report missing part of one.',
    sql: `SELECT id, status, resolved_at, resolved_by, resolution_outcome
            FROM review_reports
           WHERE NOT (
             (status = 'active' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_outcome IS NULL)
             OR
             (status = 'resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_outcome IS NOT NULL)
           )
           ORDER BY id`,
  },
  {
    key: 'hierarchy-orphans',
    description:
      'Seasons or episodes whose drama is missing, and episodes whose season belongs to another drama.',
    sql: `SELECT 'season-without-drama' AS problem, s.id, s.drama_id AS parent_a, NULL::uuid AS parent_b
            FROM seasons s WHERE NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = s.drama_id)
          UNION ALL
          SELECT 'episode-without-drama', e.id, e.drama_id, NULL::uuid
            FROM episodes e WHERE NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = e.drama_id)
          UNION ALL
          SELECT 'episode-with-foreign-season', e.id, e.drama_id, e.season_id
            FROM episodes e
            JOIN seasons s ON s.id = e.season_id
           WHERE s.drama_id <> e.drama_id`,
  },
  {
    key: 'duplicate-episode-numbers',
    description: 'Active episodes that share an episode number inside one drama.',
    sql: `SELECT drama_id, episode_number, count(*)::bigint AS rows
            FROM episodes
           WHERE deleted_at IS NULL AND episode_number IS NOT NULL
           GROUP BY drama_id, episode_number
          HAVING count(*) > 1
           ORDER BY drama_id, episode_number`,
  },
  {
    key: 'duplicate-season-positions',
    description: 'Active seasons that share a position inside one drama.',
    sql: `SELECT drama_id, position, count(*)::bigint AS rows
            FROM seasons
           WHERE deleted_at IS NULL AND position IS NOT NULL
           GROUP BY drama_id, position
          HAVING count(*) > 1
           ORDER BY drama_id, position`,
  },
  {
    key: 'duplicate-active-slugs',
    description: 'Active dramas, categories, or platforms that share a slug.',
    sql: `SELECT 'dramas' AS table_name, slug, count(*)::bigint AS rows
            FROM dramas WHERE deleted_at IS NULL GROUP BY slug HAVING count(*) > 1
          UNION ALL
          SELECT 'categories', slug, count(*) FROM categories WHERE deleted_at IS NULL GROUP BY slug HAVING count(*) > 1
          UNION ALL
          SELECT 'platforms', slug, count(*) FROM platforms WHERE deleted_at IS NULL GROUP BY slug HAVING count(*) > 1`,
  },
  {
    key: 'invalid-ratings',
    description: 'Ratings outside the 1–5 scale.',
    sql: `SELECT id, user_id, value FROM ratings WHERE value < 1 OR value > 5`,
  },
  {
    key: 'duplicate-review-reactions',
    description: 'Repeated reactions by one user on one review.',
    sql: `SELECT user_id, review_id, count(*)::bigint AS rows
            FROM review_reactions GROUP BY user_id, review_id HAVING count(*) > 1`,
  },
  {
    key: 'duplicate-active-reports',
    description: 'More than one active report by one user on one review.',
    sql: `SELECT user_id, review_id, count(*)::bigint AS rows
            FROM review_reports WHERE status = 'active'
           GROUP BY user_id, review_id HAVING count(*) > 1`,
  },
  {
    key: 'duplicate-user-content-targets',
    description: 'Duplicate bookmarks, progress, or watched-state rows for one user and target.',
    sql: `SELECT 'bookmarks-drama' AS problem, user_id, drama_id::text AS target, count(*)::bigint AS rows
            FROM bookmarks WHERE drama_id IS NOT NULL GROUP BY user_id, drama_id HAVING count(*) > 1
          UNION ALL
          SELECT 'bookmarks-movie', user_id, movie_id::text, count(*) FROM bookmarks WHERE movie_id IS NOT NULL GROUP BY user_id, movie_id HAVING count(*) > 1
          UNION ALL
          SELECT 'playback-progress-episode', user_id, episode_id::text, count(*) FROM playback_progress WHERE episode_id IS NOT NULL GROUP BY user_id, episode_id HAVING count(*) > 1
          UNION ALL
          SELECT 'playback-progress-movie', user_id, movie_id::text, count(*) FROM playback_progress WHERE movie_id IS NOT NULL GROUP BY user_id, movie_id HAVING count(*) > 1
          UNION ALL
          SELECT 'watched-state-episode', user_id, episode_id::text, count(*) FROM watched_state WHERE episode_id IS NOT NULL GROUP BY user_id, episode_id HAVING count(*) > 1
          UNION ALL
          SELECT 'watched-state-movie', user_id, movie_id::text, count(*) FROM watched_state WHERE movie_id IS NOT NULL GROUP BY user_id, movie_id HAVING count(*) > 1`,
  },
  {
    key: 'backfill-blocked-rows',
    description:
      "Rows the backfill must not place: another row of the same user already holds the target key, a row written after the migration already carries that typed target, or one of the row's other foreign keys is broken. They need a human merge.",
    sql: BACKFILL_BLOCKED_SQL,
  },
  {
    key: 'foreign-key-orphans',
    description:
      'Rows whose parent row is missing. The migration added these foreign keys in the NOT VALID posture, so the rows survive until they are reconciled.',
    sql: FOREIGN_KEY_ORPHAN_SQL,
  },
  {
    key: 'unvalidated-constraints',
    description:
      'Constraints still in the NOT VALID posture. Run `validate` once the rows above are reconciled.',
    sql: `SELECT c.conname AS constraint_name, c.conrelid::regclass::text AS table_name
            FROM pg_constraint c
           WHERE NOT c.convalidated
             AND c.connamespace = current_schema()::regnamespace
             AND c.conname LIKE ANY (ARRAY['fk_%', 'ck_%'])
           ORDER BY table_name, constraint_name`,
  },
  {
    key: 'missing-unique-indexes',
    description: 'Unique indexes the guarded migration could not create yet.',
    sql: `SELECT expected.name
            FROM (
              VALUES
                ('uq_dramas_slug_active'),
                ('uq_categories_slug_active'),
                ('uq_platforms_slug_active'),
                ('uq_episodes_drama_id_episode_number_active'),
                ('uq_seasons_drama_id_position_active'),
                ('uq_review_reactions_user_id_review_id'),
                ('uq_review_reports_user_id_review_id_active'),
                ('uq_bookmarks_user_id_drama_id'),
                ('uq_bookmarks_user_id_movie_id'),
                ('uq_playback_progress_user_id_episode_id'),
                ('uq_playback_progress_user_id_movie_id'),
                ('uq_watched_state_user_id_episode_id'),
                ('uq_watched_state_user_id_movie_id')
            ) AS expected(name)
           WHERE NOT EXISTS (
             SELECT 1 FROM pg_indexes i WHERE i.schemaname = current_schema() AND i.indexname = expected.name
           )
           ORDER BY expected.name`,
  },
];

/**
 * Load `.env.local` tolerating the encoding it is stored in.
 *
 * `dotenv` only reads UTF-8; the repository's local file may be UTF-16 LE. Real
 * environment variables always win, so CI and production are unaffected.
 */
function loadLocalEnv() {
  if (!existsSync('.env.local')) {
    return;
  }

  const contents = readFileSync('.env.local');
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

/**
 * Run every report section.
 *
 * Returns the sections rather than printing, so a test or a second consumer can
 * assert on the findings without parsing console output.
 */
export async function collectReport(client) {
  const sections = [];

  for (const section of REPORT_SECTIONS) {
    const result = await client.query(section.sql);
    sections.push({ ...section, rows: result.rows });
  }

  return sections;
}

/**
 * Apply the typed-target backfill.
 *
 * Returns the number of rows updated per statement. A second run returns zero for
 * every statement, which is what makes the operation safe to repeat.
 *
 * The rows that would collide with an existing unique key are detected first and
 * left untouched: the backfill must not abort on a collision, because an abort
 * would roll back the placements that did succeed. The colliding rows stay
 * unresolved and are listed by the report.
 *
 * The work runs in bounded batches, one transaction per batch, so a large table
 * is never locked in one go.
 */
export async function applyBackfill(client, options = {}) {
  const batchSize = options.batchSize ?? BACKFILL_BATCH_SIZE;
  const blockedRows = await detectBackfillBlockedRows(client);
  const excluded = new Map();

  for (const blocked of blockedRows) {
    const key = `${blocked.table_name}:${blocked.target_type}`;
    const ids = excluded.get(key) ?? [];
    ids.push(blocked.id);
    excluded.set(key, ids);
  }

  const updated = [];

  for (const statement of BACKFILL_STATEMENTS) {
    const ids = excluded.get(`${statement.table}:${statement.type}`) ?? [];
    let total = 0;

    for (;;) {
      const count = await runBackfillBatch(client, statement.sql, ids, batchSize);
      total += count;

      if (count < batchSize) {
        break;
      }
    }

    updated.push(total);
  }

  return updated;
}

/**
 * Find the rows the backfill must not place.
 */
export async function detectBackfillBlockedRows(client) {
  const result = await client.query(BACKFILL_BLOCKED_SQL);

  return result.rows;
}

/**
 * Run one bounded batch in its own transaction.
 */
async function runBackfillBatch(client, sql, excludedIds, batchSize) {
  await client.query('BEGIN');

  try {
    const result = await client.query(sql, [excludedIds, batchSize]);
    await client.query('COMMIT');

    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Render the report.
 *
 * Every row is printed: an operator cannot reconcile a problem the report
 * hides, and a truncated report is a report that looks complete.
 */
export function formatReport(sections) {
  const lines = [];

  for (const section of sections) {
    lines.push('', `== ${section.key} (${section.rows.length}) ==`, section.description);

    for (const row of section.rows) {
      lines.push(`  ${JSON.stringify(row)}`);
    }
  }

  lines.push('', 'Read-only report complete.');

  return lines;
}

/**
 * Validate the `NOT VALID` constraints and retry the guarded unique indexes.
 *
 * Failures are collected instead of thrown: one still-violating constraint must
 * not hide the rest of the state. The caller decides the exit code.
 */
export async function applyValidation(client) {
  const failures = [];

  for (const [table, constraint] of NOT_VALID_CONSTRAINTS) {
    try {
      await client.query(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint}`);
    } catch (error) {
      failures.push({ kind: 'constraint', name: constraint, message: error.message });
    }
  }

  for (const [name, statement] of GUARDED_UNIQUE_INDEXES) {
    try {
      // The migration creates every index it can, so a retry must not fail with
      // "relation already exists". Only the indexes that were skipped are
      // recreated; an index that is already there needs no further work.
      const existing = await client.query(
        'SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1',
        [name]
      );

      if ((existing.rowCount ?? 0) > 0) {
        continue;
      }

      await client.query(statement);
    } catch (error) {
      failures.push({ kind: 'index', name, message: error.message });
    }
  }

  return failures;
}

async function runCli() {
  const command = (process.argv[2] ?? 'report').toLowerCase();

  if (!['report', 'backfill', 'validate'].includes(command)) {
    console.error(`Unknown command "${command}". Use report, backfill, or validate.`);
    process.exitCode = 2;
    return;
  }

  loadLocalEnv();

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL is not set. Pass it in the environment or add it to .env.local.');
    process.exitCode = 2;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    if (command === 'report') {
      const sections = await collectReport(client);

      for (const line of formatReport(sections)) {
        console.log(line);
      }

      return;
    }

    if (command === 'backfill') {
      const updated = await applyBackfill(client);
      console.log(
        `Backfill complete. Rows updated per statement: ${updated.join(', ')}. ` +
          'Ambiguous rows are untouched; run `report` to list them.'
      );
      return;
    }

    const failures = await applyValidation(client);

    if (failures.length === 0) {
      console.log('All constraints validated and all unique indexes created.');
      return;
    }

    console.error(`Validation reported ${failures.length} unresolved item(s):`);

    for (const failure of failures) {
      console.error(`  [${failure.kind}] ${failure.name}: ${failure.message}`);
    }

    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// `file://${process.argv[1]}` is not a valid URL on Windows (the drive letter is
// read as a host), so the comparison uses the platform-aware helper instead.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runCli().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
