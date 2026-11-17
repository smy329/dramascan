/**
 * User-feature schema fragment (owned by `users`).
 *
 * Tables are added by the bookmark and viewing data-model prompts.
 * Planned tables: `bookmarks`, `playback_progress`, `watched_state`, `watch_history`.
 *
 * Only the `users` module may write these tables. `src/db/schema.ts`
 * assembles this namespace.
 *
 * Drama-level bookmarks: users maintain one personal My List of dramas.
 * Playback progress: per-episode position tracking with timestamps.
 * Watched/unwatched state: per-episode completed status using a configured
 * completion threshold.
 * Watch history: preserved historical viewing records with timestamps.
 *
 * Bookmark conventions: one bookmark per user per drama/movie; no episode-level
 * bookmarks or custom user-created lists.
 *
 * Playback conventions: progress updates are debounced; server-side data is the
 * source of truth. Progress is not written on every second.
 *
 * History conventions: duplicate records for every progress update are avoided;
 * meaningful timestamps and ordering are preserved. Guest analytics are kept
 * separate from authenticated user's personal watch history.
 */
import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { checkConstraint, indexOn, uuidPrimaryKey } from '@/platform/db/schema-helpers';

// ----- bookmarks -----
// One bookmark per user per drama or movie. Both indexes are partial because a
// row only has one of the two targets.
export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuidPrimaryKey(),
    user_id: uuid('user_id').notNull(),
    content_type: text('content_type').notNull().default('drama'), // legacy: drama | movie
    content_id: uuid('content_id').notNull(), // legacy target id
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
  },
  table => [
    checkConstraint(
      'bookmarks',
      'target',
      sql`(${table.drama_id} is not null and ${table.movie_id} is null) or (${table.drama_id} is null and ${table.movie_id} is not null)`
    ),
    uniqueIndex('uq_bookmarks_user_id_drama_id')
      .on(table.user_id, table.drama_id)
      .where(sql`${table.drama_id} is not null`),
    uniqueIndex('uq_bookmarks_user_id_movie_id')
      .on(table.user_id, table.movie_id)
      .where(sql`${table.movie_id} is not null`),
    indexOn('bookmarks', table.user_id),
  ]
);

// ----- playback_progress -----
export const playback_progress = pgTable(
  'playback_progress',
  {
    id: uuidPrimaryKey(),
    user_id: uuid('user_id').notNull(),
    content_type: text('content_type').notNull().default('drama'), // legacy: drama | movie
    content_id: uuid('content_id').notNull(), // legacy target id
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
    episode_id: uuid('episode_id'), // nullable: NULL for movie-level or drama-level
    position: integer('position'), // playback position in seconds
    duration: integer('duration'), // total duration in seconds
    last_watched_at: timestamp('last_watched_at', { withTimezone: true }).notNull().defaultNow(),
    completed: boolean('completed').default(false),
  },
  table => [
    checkConstraint(
      'playback_progress',
      'target',
      sql`(${table.drama_id} is not null and ${table.movie_id} is null) or (${table.drama_id} is null and ${table.movie_id} is not null)`
    ),
    // Progress is a resume point, not a log: one row per user per episode and one
    // per user per movie. The debounced write updates that row in place.
    uniqueIndex('uq_playback_progress_user_id_episode_id')
      .on(table.user_id, table.episode_id)
      .where(sql`${table.episode_id} is not null`),
    uniqueIndex('uq_playback_progress_user_id_movie_id')
      .on(table.user_id, table.movie_id)
      .where(sql`${table.movie_id} is not null`),
    indexOn('playback_progress', table.user_id, table.last_watched_at),
    indexOn('playback_progress', table.episode_id),
  ]
);

// ----- watched_state -----
export const watched_state = pgTable(
  'watched_state',
  {
    id: uuidPrimaryKey(),
    user_id: uuid('user_id').notNull(),
    content_type: text('content_type').notNull().default('drama'), // legacy: drama | movie
    content_id: uuid('content_id').notNull(), // legacy target id
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
    episode_id: uuid('episode_id'), // nullable: NULL for drama-level or movie-level
    watched_minutes: integer('watched_minutes').default(0), // minutes watched
    threshold_met: boolean('threshold_met').default(false), // completion threshold reached
    last_watched_at: timestamp('last_watched_at', { withTimezone: true }).notNull().defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }), // when threshold was first met
    completed_at_reset_at: timestamp('completed_at_reset_at', { withTimezone: true }), // when progress was last reset
  },
  table => [
    checkConstraint(
      'watched_state',
      'target',
      sql`(${table.drama_id} is not null and ${table.movie_id} is null) or (${table.drama_id} is null and ${table.movie_id} is not null)`
    ),
    uniqueIndex('uq_watched_state_user_id_episode_id')
      .on(table.user_id, table.episode_id)
      .where(sql`${table.episode_id} is not null`),
    uniqueIndex('uq_watched_state_user_id_movie_id')
      .on(table.user_id, table.movie_id)
      .where(sql`${table.movie_id} is not null`),
    indexOn('watched_state', table.user_id, table.last_watched_at),
    indexOn('watched_state', table.episode_id),
  ]
);

// ----- watch_history -----
// History is append-only by design: the same user may watch the same episode on
// several dates, and those sessions are the record. There is deliberately no
// uniqueness beyond the primary key.
export const watch_history = pgTable(
  'watch_history',
  {
    id: uuidPrimaryKey(),
    user_id: uuid('user_id').notNull(),
    content_type: text('content_type').notNull().default('drama'), // legacy: drama | movie
    content_id: uuid('content_id').notNull(), // legacy target id
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
    episode_id: uuid('episode_id'), // nullable
    watched_at: timestamp('watched_at', { withTimezone: true }).notNull().defaultNow(), // when they watched it
    watch_duration: integer('watch_duration'), // total minutes watched in this session
    session_id: text('session_id'), // identifier for cross-device sync session
  },
  table => [
    checkConstraint(
      'watch_history',
      'target',
      sql`(${table.drama_id} is not null and ${table.movie_id} is null) or (${table.drama_id} is null and ${table.movie_id} is not null)`
    ),
    indexOn('watch_history', table.user_id, table.watched_at),
    indexOn('watch_history', table.episode_id),
  ]
);

export type UserTables =
  typeof bookmarks | typeof playback_progress | typeof watched_state | typeof watch_history;

export type UserSchema =
  typeof bookmarks | typeof playback_progress | typeof watched_state | typeof watch_history;

export {};
