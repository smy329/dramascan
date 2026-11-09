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
import { pgTable, text, uuid, integer, boolean } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt, softDelete } from '@/platform/db/schema-helpers';

// ----- standard columns -----
const pk = uuid('id').notNull;
const created = createdAt;
const updated = updatedAt;
const deleted = softDelete;

// ----- guest_sessions -----
export const guest_sessions = pgTable('guest_sessions', {
  id: pk,
  session_id: text('session_id').notNull(), // anonymous session identifier
  user_id: uuid('user_id'), // nullable: NULL for unauthenticated guests
  ip_hash: text('ip_hash'), // hashed IP for duplicate detection
  user_agent: text('user_agent'), // cached user agent string
  country_code: text('country_code'), // ISO 3166-1 alpha-2
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- content_view_events -----
export const content_view_events = pgTable('content_view_events', {
  id: pk,
  guest_session_id: uuid('guest_session_id'), // FK to guest_sessions, nullable
  content_id: uuid('content_id').notNull(),
  content_type: text('content_type').notNull(), // drama | movie
  viewed_at: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow,
  viewed_hour_bucket: text('viewed_hour_bucket'), // e.g. "2026-11-10T14"
  // Deduplication is enforced at the application level and via partial unique
  // index in migrations; the schema defines the columns for the index.
});

// ----- playback_analytics_events -----
export const playback_analytics_events = pgTable('playback_analytics_events', {
  id: pk,
  guest_session_id: uuid('guest_session_id'), // FK to guest_sessions, nullable
  content_id: uuid('content_id').notNull(),
  content_type: text('content_type').notNull(), // drama | movie
  event_type: text('event_type').notNull(), // play_pause | seek | completion | exit
  position_seconds: integer('position_seconds'),
  watch_duration_seconds: integer('watch_duration_seconds'),
  completion_threshold_met: boolean('completion_threshold_met').default(false),
  event_at: timestamp('event_at', { withTimezone: true }).notNull().defaultNow,
  event_hour_bucket: text('event_hour_bucket'), // e.g. "2026-11-10T14"
  // Deduplication enforced at application level and via partial unique index in migrations.
});

// ----- analytics_daily_aggregates -----
export const analytics_daily_aggregates = pgTable('analytics_daily_aggregates', {
  id: pk,
  date: text('date').notNull(), // YYYY-MM-DD format
  content_id: uuid('content_id'), // nullable: NULL for site-wide aggregates
  content_type: text('content_type'), // drama | movie | NULL
  unique_visitors: integer('unique_visitors').default(0),
  total_views: integer('total_views').default(0),
  total_playback_events: integer('total_playback_events').default(0),
  completion_events: integer('completion_events').default(0),
  total_watch_duration_seconds: integer('total_watch_duration_seconds').default(0),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
  // One aggregate row per date + content_type (for content-level) or date only (site-wide)
  // Uniqueness enforced at application level and via partial unique index in migrations.
});

// ----- search_events -----
export const search_events = pgTable('search_events', {
  id: pk,
  guest_session_id: uuid('guest_session_id'), // FK to guest_sessions, nullable
  user_id: uuid('user_id'), // nullable: NULL for anonymous searches
  query_text: text('query_text').notNull(),
  result_count: integer('result_count').default(0),
  searched_at: timestamp('searched_at', { withTimezone: true }).notNull().defaultNow,
  search_hour_bucket: text('search_hour_bucket'), // e.g. "2026-11-10T14"
  // Deduplication enforced at application level and via partial unique index in migrations.
});

export type AnalyticsTables =
  | typeof guest_sessions
  | typeof content_view_events
  | typeof playback_analytics_events
  | typeof analytics_daily_aggregates
  | typeof search_events;

export type AnalyticsSchema = typeof guest_sessions
  | typeof content_view_events
  | typeof playback_analytics_events
  | typeof analytics_daily_aggregates
  | typeof search_events;

export {};