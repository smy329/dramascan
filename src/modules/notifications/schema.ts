/**
 * Notification schema fragment (owned by `notifications`).
 *
 * Tables are added by the notification data-model prompt.
 *
 * Only the `notifications` module may write these tables. `src/db/schema.ts`
 * assembles this namespace.
 *
 * Convention: all tables use UUIDv7 application-owned primary keys, snake_case
 * columns, timestamptz timestamps, and `deleted_at` for soft delete. Partial
 * unique indexes `WHERE deleted_at IS NULL` enforce active-row uniqueness.
 *
 * Five event preferences (per D-005 and requirements §11):
 *   - new_episode: when a new eligible episode is manually published
 *   - new_drama_season: when a drama or season is manually published
 *   - website_announcement: when an administrator publishes a manual announcement
 *   - account_security: mandatory notifications (cannot be disabled through
 *     ordinary event preferences). Covers user deactivation/reactivation,
 *     administrator authorization/deactivation, role changes, and session
 *     termination.
 *   - global_on_off: overall in-app and browser push on/off switch
 *
 * Mandatory security notifications (per D-005) remain visible regardless of
 * event preference settings. All other notifications respect the user's
 * event preferences AND the global on/off switch.
 */
import { pgTable, text, timestamp, uuid, integer, boolean } from 'drizzle-orm/pg-core';

// ----- push_subscriptions -----
export const push_subscriptions = pgTable('push_subscriptions', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull(), // VAPI endpoint URL
  p256dh: text('p256dh'), // Public key
  auth: text('auth'), // Authentication secret
  browser: text('browser'), // Browser identifier
  user_agent: text('user_agent'), // Cached user agent
  position: integer('position'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

// ----- notification_preferences -----
export const notification_preferences = pgTable('notification_preferences', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  new_episode: boolean('new_episode').default(true),
  new_drama_season: boolean('new_drama_season').default(true),
  website_announcement: boolean('website_announcement').default(true),
  account_security: boolean('account_security').default(true),
  global_in_app: boolean('global_in_app').default(true),
  global_push: boolean('global_push').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

// ----- notifications -----
export const notifications = pgTable('notifications', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  event_type: text('event_type').notNull(), // new_episode | new_drama_season | website_announcement | account_security
  content_id: uuid('content_id'), // drama_id or movie_id or announcement id
  content_type: text('content_type'), // drama | movie | announcement
  link: text('link'), // deep link for navigation
  is_read: boolean('is_read').default(false),
  read_at: timestamp('read_at', { withTimezone: true }),
  delivered: boolean('delivered').default(false),
  delivery_timestamp: timestamp('delivery_timestamp', { withTimezone: true }),
  priority: text('priority').default('normal'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

// ----- notification_deliveries -----
export const notification_deliveries = pgTable('notification_deliveries', {
  id: uuid('id').notNull(),
  notification_id: uuid('notification_id').notNull(),
  user_id: uuid('user_id').notNull(),
  channel: text('channel').notNull(), // in_app | push
  success: boolean('success').default(false),
  error_message: text('error_message'),
  delivered_at: timestamp('delivered_at', { withTimezone: true }),
  subscription_id: uuid('subscription_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- announcements -----
export const announcements = pgTable('announcements', {
  id: uuid('id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  author_id: uuid('author_id').notNull(),
  publication_status: text('publication_status').default('draft'), // draft | published
  expires_at: timestamp('expires_at', { withTimezone: true }),
  trigger_event_types: text('trigger_event_types').array(), // [new_episode, new_drama_season, website_announcement]
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

// ----- admin_notifications -----
export const admin_notifications = pgTable('admin_notifications', {
  id: uuid('id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  audience: text('audience').default('all'), // all | super_admin | roles
  content_id: uuid('content_id'),
  content_type: text('content_type'), // drama | movie | announcement | null
  is_resolved: boolean('is_resolved').default(false),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolved_by: uuid('resolved_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});
