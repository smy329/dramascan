-- Migration 0021 — Phase 11 review fixes, round 2 (data half)
--
-- The daily aggregate table had no database-level uniqueness. Two refreshes of
-- the same day could therefore both delete their scope and both insert their
-- rows, and the dashboard would count the same day twice. The application now
-- serializes a refresh with a transaction-scoped advisory lock and inserts
-- with `ON CONFLICT DO NOTHING`, but the database is the authority that makes
-- a duplicate row impossible.
--
-- This migration is the **data half** of that fix: it removes the duplicates
-- the old application could create, keeping the most recently written row of
-- each key. The schema half — the two partial unique indexes that state the
-- logical keys of the table — is migration 0022, because the indexes cannot be
-- created while the duplicates still exist.
--
-- The cleanup rewrites rows, but only rows that were duplicates of each other:
-- no measurement is lost, and the surviving row holds the newest numbers.
--
-- The cleanup is idempotent: running it twice removes nothing the second
-- time.
--
-- Reversible: the rollback cannot restore the removed duplicates, but they
-- were duplicates, so the numbers they held are still held by the row that
-- survived.

-- ----- Remove the duplicates the old application could create ----------------
DELETE FROM "analytics_daily_aggregates" aggregate
WHERE aggregate.deleted_at IS NULL
  AND aggregate.content_type IS NULL
  AND EXISTS (
    SELECT 1
      FROM "analytics_daily_aggregates" newer
     WHERE newer.deleted_at IS NULL
       AND newer.content_type IS NULL
       AND newer.date = aggregate.date
       AND (newer.updated_at, newer.id) > (aggregate.updated_at, aggregate.id)
  );
--> statement-breakpoint

DELETE FROM "analytics_daily_aggregates" aggregate
WHERE aggregate.deleted_at IS NULL
  AND aggregate.content_type IS NOT NULL
  AND EXISTS (
    SELECT 1
      FROM "analytics_daily_aggregates" newer
     WHERE newer.deleted_at IS NULL
       AND newer.content_type IS NOT NULL
       AND newer.date = aggregate.date
       AND newer.content_type = aggregate.content_type
       AND newer.content_id = aggregate.content_id
       AND (newer.updated_at, newer.id) > (aggregate.updated_at, aggregate.id)
  );
