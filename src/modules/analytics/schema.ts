/**
 * Analytics schema fragment (owned by `analytics`).
 *
 * Tables are added by the analytics data-model prompt.
 *
 * Only the `analytics` module may write these tables. `src/db/schema.ts`
 * assembles this namespace.
 *
 * Privacy: guest analytics are kept separate from authenticated user activity.
 * Personal identifiers are not stored in anonymous event tables. All UUIDs are
 * application-owned (UUIDv7). Tables use snake_case columns, timestamptz timestamps,
 * and `deleted_at` for soft delete. Partial unique indexes `WHERE deleted_at IS NULL`
 * enforce active-row uniqueness where applicable.
 *
 * Bounded writes: episode playback analytics are aggregated, not per-second logs.
 * No Redis, pg-boss, or persistent queue is introduced.
 *
 * Guest sessions use anonymous session IDs; user identity is never co-located with
 * event-level event data in the same table.
 */
import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  checkConstraint,
  createdAt,
  deletedAt,
  indexOn,
  updatedAt,
  uuidPrimaryKey,
} from '@/platform/db/schema-helpers';

// ----- guest_sessions -----
export const guest_sessions = pgTable('guest_sessions', {
  id: uuidPrimaryKey(),
  session_id: text('session_id').notNull(), // anonymous session identifier
  user_id: uuid('user_id'), // nullable: NULL for unauthenticated guests
  ip_hash: text('ip_hash'), // hashed IP for duplicate detection
  user_agent: text('user_agent'), // cached user agent string
  country_code: text('country_code'), // ISO 3166-1 alpha-2
  created_at: createdAt(),
  updated_at: updatedAt(),
  deleted_at: deletedAt(),
});

// ----- content_view_events -----
// A view event belongs to exactly one content item. Per D-020 the target is
// expressed with typed nullable foreign keys, never a generic polymorphic
// `content_id`. The foreign keys to `dramas`/`movies` are declared in the SQL
// migration because they cross module boundaries.
export const content_view_events = pgTable(
  'content_view_events',
  {
    id: uuidPrimaryKey(),
    guest_session_id: uuid('guest_session_id'), // FK to guest_sessions, nullable
    content_id: uuid('content_id').notNull(), // legacy target id
    content_type: text('content_type').notNull(), // legacy: drama | movie
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
    viewed_at: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
    viewed_hour_bucket: text('viewed_hour_bucket'), // e.g. "2026-11-10T14"
    deleted_at: deletedAt(),
    // Deduplication is enforced at the application level and via partial unique
    // index in migrations; the schema defines the columns for the index.
  },
  table => [
    checkConstraint(
      'content_view_events',
      'target',
      sql`(${table.drama_id} is not null and ${table.movie_id} is null) or (${table.drama_id} is null and ${table.movie_id} is not null)`
    ),
    indexOn('content_view_events', table.drama_id),
    indexOn('content_view_events', table.movie_id),
  ]
);

// ----- playback_analytics_events -----
export const playback_analytics_events = pgTable(
  'playback_analytics_events',
  {
    id: uuidPrimaryKey(),
    guest_session_id: uuid('guest_session_id'), // FK to guest_sessions, nullable
    content_id: uuid('content_id').notNull(), // the episode or movie the event describes
    content_type: text('content_type').notNull(), // drama | movie
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
    episode_id: uuid('episode_id'), // set when the event describes one episode
    event_type: text('event_type').notNull(), // play | play_pause | seek | completion | exit
    position_seconds: integer('position_seconds'),
    watch_duration_seconds: integer('watch_duration_seconds'),
    completion_threshold_met: boolean('completion_threshold_met').default(false),
    event_at: timestamp('event_at', { withTimezone: true }).notNull().defaultNow(),
    event_hour_bucket: text('event_hour_bucket'), // e.g. "2026-11-10T14"
    deleted_at: deletedAt(),
    // Deduplication enforced at application level and via partial unique index in migrations.
  },
  table => [
    checkConstraint(
      'playback_analytics_events',
      'target',
      sql`(${table.drama_id} is not null and ${table.movie_id} is null) or (${table.drama_id} is null and ${table.movie_id} is not null)`
    ),
    indexOn('playback_analytics_events', table.drama_id),
    indexOn('playback_analytics_events', table.movie_id),
  ]
);

// ----- analytics_daily_aggregates -----
// A daily aggregate may be site-wide, so both typed targets may stay null. The
// rule it must still obey is that a row cannot name a drama *and* a movie at
// the same time.
export const analytics_daily_aggregates = pgTable(
  'analytics_daily_aggregates',
  {
    id: uuidPrimaryKey(),
    date: text('date').notNull(), // YYYY-MM-DD format
    content_id: uuid('content_id'), // legacy target id; NULL for site-wide aggregates
    content_type: text('content_type'), // legacy: drama | movie | NULL
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
    unique_visitors: integer('unique_visitors').default(0),
    total_views: integer('total_views').default(0),
    total_playback_events: integer('total_playback_events').default(0),
    /** Playback starts: the bounded `play` event, one per viewer/content/hour. */
    playback_starts: integer('playback_starts').default(0),
    /** Distinct visitors that actually played something (not merely opened a page). */
    playback_viewers: integer('playback_viewers').default(0),
    completion_events: integer('completion_events').default(0),
    total_watch_duration_seconds: integer('total_watch_duration_seconds').default(0),
    created_at: createdAt(),
    updated_at: updatedAt(),
    deleted_at: deletedAt(),
    // The logical key of a row is its day plus its target: the site-wide row
    // of a day, or the row of one title. The partial unique indexes that
    // enforce it live in `drizzle/0021_phase11_review_fixes_round2.sql`
    // (D-070).
  },
  table => [
    checkConstraint(
      'analytics_daily_aggregates',
      'target',
      sql`${table.drama_id} is null or ${table.movie_id} is null`
    ),
    indexOn('analytics_daily_aggregates', table.drama_id),
    indexOn('analytics_daily_aggregates', table.movie_id),
  ]
);

// ----- search_events -----
export const search_events = pgTable('search_events', {
  id: uuidPrimaryKey(),
  guest_session_id: uuid('guest_session_id'), // FK to guest_sessions, nullable
  user_id: uuid('user_id'), // nullable: NULL for anonymous searches
  query_text: text('query_text').notNull(),
  result_count: integer('result_count').default(0),
  searched_at: timestamp('searched_at', { withTimezone: true }).notNull().defaultNow(),
  search_hour_bucket: text('search_hour_bucket'), // e.g. "2026-11-10T14"
  deleted_at: deletedAt(),
  // Deduplication enforced at application level and via partial unique index in migrations.
});

export type AnalyticsTables =
  | typeof guest_sessions
  | typeof content_view_events
  | typeof playback_analytics_events
  | typeof analytics_daily_aggregates
  | typeof search_events;

export type AnalyticsSchema =
  | typeof guest_sessions
  | typeof content_view_events
  | typeof playback_analytics_events
  | typeof analytics_daily_aggregates
  | typeof search_events;

export {};
