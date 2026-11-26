-- Migration 0018 — Analytics and notifications support
--
-- This migration completes the analytics and notification data model:
--
--   - the append-only event tables gain the soft-delete column the schema and
--     the partial unique indexes rely on;
--   - the analytics event tables gain the foreign keys that tie an event to
--     the guest session and the episode it describes;
--   - the deduplication indexes make the six-hour view window and the bounded
--     playback writes enforceable at the database level;
--   - the notification preference row gains the separate "new drama" switch
--     the requirements ask for.
--
-- All indexes use a `deleted_at IS NULL` partial filter so soft-deleted rows
-- do not affect deduplication or counts.
--
-- Reversible: the rollback drops the indexes, the foreign keys, and the added
-- columns (`deleted_at`, `episode_id`, `new_drama`). The event rows stay, but
-- their soft-delete state, their episode reference, and the new-drama switch
-- are lost with the columns.

-- ----- Soft-delete columns -------------------------------------------------
ALTER TABLE "content_view_events" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "playback_analytics_events" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "search_events" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

-- ----- Episode attribution -------------------------------------------------
-- A playback event names the episode that was watched. The typed target
-- columns keep naming the drama or the movie the episode belongs to, so the
-- dashboard can still roll episode playback up to its drama.
ALTER TABLE "playback_analytics_events" ADD COLUMN IF NOT EXISTS "episode_id" uuid;

-- ----- Foreign keys --------------------------------------------------------
ALTER TABLE "content_view_events" ADD CONSTRAINT "fk_content_view_events_guest_session_id" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "playback_analytics_events" ADD CONSTRAINT "fk_playback_analytics_events_guest_session_id" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "playback_analytics_events" ADD CONSTRAINT "fk_playback_analytics_events_episode_id" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "search_events" ADD CONSTRAINT "fk_search_events_guest_session_id" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action NOT VALID;

-- ----- Deduplication indexes -----------------------------------------------
-- One active guest session per anonymous session identifier, and one per
-- linked account. The account index is what keeps a signed-in viewer's
-- visitor key stable across requests.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_guest_sessions_session_id"
ON "guest_sessions" (session_id)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_guest_sessions_user_id"
ON "guest_sessions" (user_id)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- One view per visitor, content item and hour bucket. The six-hour rolling
-- window is applied by the application on top of this safety net.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_content_view_events_dedup"
ON "content_view_events" (content_id, content_type, guest_session_id, viewed_hour_bucket)
WHERE deleted_at IS NULL;

-- One playback event of each type per visitor, content item and hour bucket.
-- This is the bound that keeps playback analytics from becoming a per-second
-- log while still allowing play, seek, completion and exit to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_playback_analytics_events_dedup"
ON "playback_analytics_events" (content_id, content_type, guest_session_id, event_type, event_hour_bucket)
WHERE deleted_at IS NULL;

-- One search per guest session and hour bucket.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_search_events_dedup"
ON "search_events" (guest_session_id, search_hour_bucket)
WHERE deleted_at IS NULL;

-- ----- Notification indexes ------------------------------------------------
-- One active preference row per account.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_preferences_active"
ON "notification_preferences" (user_id)
WHERE deleted_at IS NULL;

-- One active subscription per account and browser endpoint. A viewer may hold
-- several subscriptions — one per device — but never two for one endpoint.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_push_subscriptions_active"
ON "push_subscriptions" (user_id, endpoint)
WHERE deleted_at IS NULL;

-- ----- Query indexes -------------------------------------------------------
-- The six-hour window lookup: a visitor's recent views of one content item.
CREATE INDEX IF NOT EXISTS "idx_content_view_events_visitor_window"
ON "content_view_events" (guest_session_id, content_id, content_type, viewed_at)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_view_events_viewed_at"
ON "content_view_events" (viewed_at)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_playback_analytics_events_event_at"
ON "playback_analytics_events" (event_at)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_playback_analytics_events_episode_id"
ON "playback_analytics_events" (episode_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_analytics_daily_aggregates_date"
ON "analytics_daily_aggregates" (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_analytics_daily_aggregates_content"
ON "analytics_daily_aggregates" (content_type, content_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_recent"
ON "notifications" (user_id, created_at DESC)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
ON "notifications" (user_id)
WHERE deleted_at IS NULL AND is_read = false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_notification"
ON "notification_deliveries" (notification_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_announcements_publication_status"
ON "announcements" (publication_status, created_at DESC)
WHERE deleted_at IS NULL;

-- ----- Independent event preferences --------------------------------------
-- Requirements §11.1 lists five independent event preferences. "Newly
-- published dramas" and "new seasons" are separate preferences, so they need
-- separate columns; the shared `new_drama_season` column only ever covered
-- the season case.
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "new_drama" boolean DEFAULT true;
