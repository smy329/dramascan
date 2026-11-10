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
import { pgTable, text, timestamp, uuid, integer, boolean } from 'drizzle-orm/pg-core';
import { uuidPrimaryKey } from '@/platform/db/schema-helpers';

// ----- bookmarks -----
export const bookmarks = pgTable('bookmarks', {
  id: uuidPrimaryKey(),
  user_id: uuid('user_id').notNull(),
  content_type: text('content_type').notNull().default('drama'), // drama | movie
  content_id: uuid('content_id').notNull(),
});

// ----- playback_progress -----
export const playback_progress = pgTable('playback_progress', {
  id: uuidPrimaryKey(),
  user_id: uuid('user_id').notNull(),
  content_type: text('content_type').notNull().default('drama'), // drama | movie
  content_id: uuid('content_id').notNull(), // drama_id or movie_id
  episode_id: uuid('episode_id'), // nullable: NULL for movie-level or drama-level
  position: integer('position'), // playback position in seconds
  duration: integer('duration'), // total duration in seconds
  last_watched_at: timestamp('last_watched_at', { withTimezone: true }).notNull().defaultNow(),
  completed: boolean('completed').default(false),
});

// ----- watched_state -----
export const watched_state = pgTable('watched_state', {
  id: uuidPrimaryKey(),
  user_id: uuid('user_id').notNull(),
  content_type: text('content_type').notNull().default('drama'), // drama | movie
  content_id: uuid('content_id').notNull(), // drama_id or movie_id
  episode_id: uuid('episode_id'), // nullable: NULL for drama-level or movie-level
  watched_minutes: integer('watched_minutes').default(0), // minutes watched
  threshold_met: boolean('threshold_met').default(false), // completion threshold reached
  last_watched_at: timestamp('last_watched_at', { withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }), // when threshold was first met
  completed_at_reset_at: timestamp('completed_at_reset_at', { withTimezone: true }), // when progress was last reset
});

// ----- watch_history -----
export const watch_history = pgTable('watch_history', {
  id: uuidPrimaryKey(),
  user_id: uuid('user_id').notNull(),
  content_type: text('content_type').notNull().default('drama'), // drama | movie
  content_id: uuid('content_id').notNull(), // drama_id or movie_id
  episode_id: uuid('episode_id'), // nullable
  watched_at: timestamp('watched_at', { withTimezone: true }).notNull().defaultNow(), // when they watched it
  watch_duration: integer('watch_duration'), // total minutes watched in this session
  session_id: text('session_id'), // identifier for cross-device sync session
});

export type UserTables =
  typeof bookmarks | typeof playback_progress | typeof watched_state | typeof watch_history;

export type UserSchema =
  typeof bookmarks | typeof playback_progress | typeof watched_state | typeof watch_history;

export {};
