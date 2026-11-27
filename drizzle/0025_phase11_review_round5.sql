-- Migration 0025 — Phase 11 review fixes, round 5 (typed analytics targets)
--
-- The typed target wins over the legacy `content_type`/`content_id` pair
-- (D-032 §4, D-082). The read paths now filter on the effective target, and
-- the indexes follow it: the hourly safety net keys on the effective target,
-- and a lookup index carries the effective target so the six-hour window
-- check and the public counts stay indexed.
--
-- Two rows of one visitor, one effective target and one hour bucket are one
-- view. The rows the application writes name the same target in both pairs,
-- so the clean-up below touches only the anomalies the integrity report
-- lists; the newer row is soft-deleted, never removed.
--
-- Reversible: the rollback drops the effective-target indexes, recreates the
-- legacy indexes and restores the soft-deleted duplicates. The index names are
-- unchanged, so the rollback is a drop-and-create.

UPDATE "content_view_events" newer
   SET "deleted_at" = now()
  FROM "content_view_events" older
 WHERE newer."id" > older."id"
   AND newer."deleted_at" IS NULL
   AND older."deleted_at" IS NULL
   AND newer."guest_session_id" = older."guest_session_id"
   AND (CASE WHEN newer."drama_id" IS NOT NULL THEN 'drama' WHEN newer."movie_id" IS NOT NULL THEN 'movie' ELSE newer."content_type" END)
     = (CASE WHEN older."drama_id" IS NOT NULL THEN 'drama' WHEN older."movie_id" IS NOT NULL THEN 'movie' ELSE older."content_type" END)
   AND COALESCE(newer."drama_id", newer."movie_id", newer."content_id")
     = COALESCE(older."drama_id", older."movie_id", older."content_id")
   AND newer."viewed_hour_bucket" = older."viewed_hour_bucket";
--> statement-breakpoint

DROP INDEX IF EXISTS "uq_content_view_events_dedup";
--> statement-breakpoint

-- One view per visitor, effective target and hour bucket. The six-hour rolling
-- window is applied by the application on top of this safety net.
CREATE UNIQUE INDEX "uq_content_view_events_dedup"
ON "content_view_events" (
  (CASE WHEN "drama_id" IS NOT NULL THEN 'drama' WHEN "movie_id" IS NOT NULL THEN 'movie' ELSE "content_type" END),
  (COALESCE("drama_id", "movie_id", "content_id")),
  "guest_session_id",
  "viewed_hour_bucket"
)
WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- The lookup index of the six-hour window check and of the public view count:
-- the effective target, the visitor and the instant of the view.
CREATE INDEX IF NOT EXISTS "idx_content_view_events_visitor_target"
ON "content_view_events" (
  (CASE WHEN "drama_id" IS NOT NULL THEN 'drama' WHEN "movie_id" IS NOT NULL THEN 'movie' ELSE "content_type" END),
  (COALESCE("drama_id", "movie_id", "content_id")),
  "guest_session_id",
  "viewed_at"
)
WHERE "deleted_at" IS NULL;
--> statement-breakpoint

UPDATE "playback_analytics_events" newer
   SET "deleted_at" = now()
  FROM "playback_analytics_events" older
 WHERE newer."id" > older."id"
   AND newer."deleted_at" IS NULL
   AND older."deleted_at" IS NULL
   AND newer."guest_session_id" = older."guest_session_id"
   AND (CASE WHEN newer."drama_id" IS NOT NULL THEN 'drama' WHEN newer."movie_id" IS NOT NULL THEN 'movie' ELSE newer."content_type" END)
     = (CASE WHEN older."drama_id" IS NOT NULL THEN 'drama' WHEN older."movie_id" IS NOT NULL THEN 'movie' ELSE older."content_type" END)
   AND COALESCE(newer."episode_id", newer."movie_id", newer."content_id")
     = COALESCE(older."episode_id", older."movie_id", older."content_id")
   AND newer."event_type" = older."event_type"
   AND newer."event_hour_bucket" = older."event_hour_bucket";
--> statement-breakpoint

DROP INDEX IF EXISTS "uq_playback_analytics_events_dedup";
--> statement-breakpoint

-- One playback event of each type per visitor, effective content and hour
-- bucket. The bound is what keeps playback analytics from becoming a
-- per-second log while still allowing play, seek, completion and exit to
-- coexist.
CREATE UNIQUE INDEX "uq_playback_analytics_events_dedup"
ON "playback_analytics_events" (
  (CASE WHEN "drama_id" IS NOT NULL THEN 'drama' WHEN "movie_id" IS NOT NULL THEN 'movie' ELSE "content_type" END),
  (COALESCE("episode_id", "movie_id", "content_id")),
  "guest_session_id",
  "event_type",
  "event_hour_bucket"
)
WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- The lookup index of the previous-event check and of the playback summary.
CREATE INDEX IF NOT EXISTS "idx_playback_analytics_events_visitor_target"
ON "playback_analytics_events" (
  (CASE WHEN "drama_id" IS NOT NULL THEN 'drama' WHEN "movie_id" IS NOT NULL THEN 'movie' ELSE "content_type" END),
  (COALESCE("drama_id", "movie_id")),
  "guest_session_id",
  "event_at"
)
WHERE "deleted_at" IS NULL;
