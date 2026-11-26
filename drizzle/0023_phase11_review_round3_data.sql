-- Migration 0023 — Phase 11 review fixes, round 3 (data half)
--
-- Migration 0022 gave the analytics event tables a `viewer_type` column that
-- records how the viewer was classified when the event happened. The rows that
-- were written before that column existed carry the default, `guest`, which
-- is wrong for the events of the signed-in viewers.
--
-- The historical classification cannot be recovered exactly: the session row
-- is linked to an account when the viewer signs in, so the link of today says
-- that the viewer is authenticated now, not that they were authenticated when
-- the event was recorded. The link is the best evidence available, so it is
-- what the backfill uses, and every event of a session that was linked to an
-- account at that moment is classified as authenticated.
--
-- The backfill is idempotent: running it twice writes the same values.
--
-- Reversible: the rollback cannot restore the `guest` default of the rows it
-- reclassified, because the original classification was never stored.

UPDATE "content_view_events" event
SET "viewer_type" = 'authenticated'
FROM "guest_sessions" session
WHERE event."guest_session_id" = session."id"
  AND session."user_id" IS NOT NULL
  AND session."deleted_at" IS NULL
  AND event."viewer_type" <> 'authenticated';
--> statement-breakpoint

UPDATE "playback_analytics_events" event
SET "viewer_type" = 'authenticated'
FROM "guest_sessions" session
WHERE event."guest_session_id" = session."id"
  AND session."user_id" IS NOT NULL
  AND session."deleted_at" IS NULL
  AND event."viewer_type" <> 'authenticated';
