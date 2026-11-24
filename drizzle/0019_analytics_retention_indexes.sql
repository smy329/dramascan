-- Migration 0019 — Analytics retention indexes
--
-- The analytics retention command removes the rows that the retention policy
-- no longer keeps. Every statement it runs is a range lookup over a
-- timestamp column, so it needs an index: without one the command would read
-- a whole table on every run, which is the unbounded query the requirements
-- forbid.
--
-- The third index serves the "is any event still pointing at this session?"
-- check of the guest-session removal. The event tables use `ON DELETE SET
-- NULL`, so a session row may only be removed once no event points at it.
--
-- Reversible: the rollback drops the three indexes. No row is rewritten by
-- this migration.

CREATE INDEX IF NOT EXISTS "idx_guest_sessions_created_at"
ON "guest_sessions" (created_at)
WHERE user_id IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_search_events_searched_at"
ON "search_events" (searched_at)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_playback_analytics_events_guest_session"
ON "playback_analytics_events" (guest_session_id);
