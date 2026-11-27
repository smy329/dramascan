-- Migration 0026 — Phase 11 review fixes, round 5 (playback viewing sessions)
--
-- The server keeps the baseline of every viewing session, so the watch time a
-- beacon claims is measured against a server-stamped instant and against the
-- cumulative watch time the server has already accounted for (D-090).
--
-- Before this migration the browser reported a *delta* and the server clamped
-- it against the previous stored event. Two things could then go wrong: the
-- first beacon of a viewing had no previous event to measure against, so it
-- could claim a whole day of watch time; and a lost acknowledgement made the
-- browser report the same delta again, so the same watch time was counted
-- twice.
--
-- The session row is the server's own record of the viewing:
--
--   - `started_at` is stamped by the server when the session is created, so
--     the first beacon is measured against the moment the session began.
--   - `last_cumulative_watch_seconds` is the cumulative watch time the server
--     has already accounted for, so a repeated cumulative claim is a delta of
--     zero and a lost acknowledgement cannot double-count a delta.
--   - `client_session_key` separates two tabs of the same viewer, so the
--     second tab does not reset the baseline of the first one.
--
-- One row per visitor, content item and client session. The row is a
-- baseline, not a log: the bounded write of the events themselves stays in
-- `playback_analytics_events`.
--
-- Reversible: the rollback drops the table. The events it guarded keep their
-- watch durations; only the baseline is lost, and the next event of a viewer
-- starts a new session.

CREATE TABLE IF NOT EXISTS "playback_viewing_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"guest_session_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"drama_id" uuid,
	"movie_id" uuid,
	"client_session_key" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL DEFAULT now(),
	"last_event_at" timestamp with time zone,
	"last_cumulative_watch_seconds" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

-- One active session per visitor, content item and client session.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_playback_viewing_sessions_visitor_content"
ON "playback_viewing_sessions" ("guest_session_id", "content_id", "client_session_key")
WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- The retention command removes the sessions that ended long ago.
CREATE INDEX IF NOT EXISTS "idx_playback_viewing_sessions_started_at"
ON "playback_viewing_sessions" ("started_at");
--> statement-breakpoint

ALTER TABLE "playback_viewing_sessions" ADD CONSTRAINT "fk_playback_viewing_sessions_guest_session_id" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
