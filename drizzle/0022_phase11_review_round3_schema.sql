-- Migration 0022 — Phase 11 review fixes, round 2 (schema half) and the
-- request-time viewer classification of round 3.
--
-- ----- The logical keys of the daily aggregate table -------------------------
--
-- Two partial unique indexes state the two logical keys of
-- `analytics_daily_aggregates`:
--
--   - the site-wide row of a day: `(date)`, where `content_type IS NULL`;
--   - the row of a title: `(date, content_type, content_id)`, where the
--     content type is set.
--
-- The indexes are partial (`deleted_at IS NULL`), because a soft-deleted row
-- is history and does not collide with the live row of the same key.
--
-- The duplicates the old application could create are removed by migration
-- 0021, which has to run first: a unique index cannot be created on a table
-- that still holds duplicates.
--
-- ----- The viewer classification --------------------------------------------
--
-- The analytics event tables carried no answer to "was this viewer signed in
-- when the event happened?". The `guest_sessions.user_id` column cannot answer
-- it either: the row is linked to the account when the viewer signs in, so a
-- later join reclassifies the events that were recorded before the sign-in.
--
-- Both event tables therefore carry a `viewer_type` column that names the
-- classification of the request, and nothing else: no personal identifier is
-- stored on an event row (D-074).
--
-- The column is not null and defaults to `guest`, so a row written before the
-- change keeps a valid classification. Migration 0023 replaces the default of
-- the historical rows with the best evidence available.
--
-- Reversible: the rollback drops the two indexes and the two columns. The
-- classification of the rows is lost with the columns, and the rows stay.

-- ----- The logical keys of the table ----------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_daily_aggregates_site_date"
ON "analytics_daily_aggregates" (date)
WHERE content_type IS NULL AND deleted_at IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_daily_aggregates_content_date"
ON "analytics_daily_aggregates" (date, content_type, content_id)
WHERE content_type IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint

-- ----- The viewer classification of the event rows --------------------------
ALTER TABLE "content_view_events"
ADD COLUMN IF NOT EXISTS "viewer_type" text NOT NULL DEFAULT 'guest';
--> statement-breakpoint

ALTER TABLE "playback_analytics_events"
ADD COLUMN IF NOT EXISTS "viewer_type" text NOT NULL DEFAULT 'guest';
