-- Migration 0020 — Phase 11 review fixes
--
-- Four data-model gaps found in the Phase 11 review:
--
--   1. Notification de-duplication was application-only (a read-then-write),
--      so two concurrent publication retries could both write the same
--      notification. The partial unique index is the database safety net;
--      `content_id IS NULL` rows are excluded because PostgreSQL treats NULLs
--      as distinct and mandatory account/security rows legitimately share an
--      event type.
--   2. Delivery maintenance needs an index over the delivery records it reads:
--      "has this notification ever been pushed successfully?" and "how many
--      attempts has it had?".
--   3. The admin notification centre needs read state per administrator, a
--      category, a deep link, a priority, and the role audience the existing
--      `audience` column promised but could not express.
--   4. The analytics dashboard needs a real playback-start metric and a
--      playback-viewer count, so completion rate and average watch time stop
--      being ratios over unrelated denominators.
--
-- Reversible: the rollback drops the new table, indexes, and columns. No row
-- is rewritten.

-- ----- Notification de-duplication ----------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_user_event_content"
ON "notifications" (user_id, event_type, content_id)
WHERE deleted_at IS NULL AND content_id IS NOT NULL;
--> statement-breakpoint

-- ----- Delivery maintenance -------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_notification_channel"
ON "notification_deliveries" (notification_id, channel, success);
--> statement-breakpoint

-- ----- Admin notification centre -------------------------------------------
ALTER TABLE "admin_notifications" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'system';
--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD COLUMN IF NOT EXISTS "link" text;
--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD COLUMN IF NOT EXISTS "audience_roles" text[];
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_notification_reads" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "notification_id" uuid NOT NULL,
  "admin_user_id" uuid NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_notification_reads_notification_user"
ON "admin_notification_reads" (notification_id, admin_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_notification_reads_admin_user"
ON "admin_notification_reads" (admin_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_notifications_created_at"
ON "admin_notifications" (created_at)
WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ----- Analytics metric denominators ---------------------------------------
ALTER TABLE "analytics_daily_aggregates" ADD COLUMN IF NOT EXISTS "playback_starts" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "analytics_daily_aggregates" ADD COLUMN IF NOT EXISTS "playback_viewers" integer DEFAULT 0;
