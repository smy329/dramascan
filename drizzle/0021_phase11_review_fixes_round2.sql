-- Migration 0021 — Phase 11 review fixes, round 2
--
-- The daily aggregate table had no database-level uniqueness. Two refreshes of
-- the same day could therefore both delete their scope and both insert their
-- rows, and the dashboard would count the same day twice. The application now
-- serializes a refresh with a transaction-scoped advisory lock and inserts
-- with `ON CONFLICT DO NOTHING`, but the database is the authority that makes
-- a duplicate row impossible.
--
-- Two partial unique indexes state the two logical keys of the table:
--
--   - the site-wide row of a day: `(date)`, where `content_type IS NULL`;
--   - the row of a title: `(date, content_type, content_id)`, where the
--     content type is set.
--
-- The indexes are partial (`deleted_at IS NULL`), because a soft-deleted row
-- is history and does not collide with the live row of the same key.
--
-- The duplicates the old application could create are removed first, keeping
-- the most recently written row of each key. The migration therefore rewrites
-- rows, but only rows that were duplicates of each other: no measurement is
-- lost, and the surviving row holds the newest numbers.
--
-- Reversible: the rollback drops the two indexes. The rows the cleanup
-- removed are not restored, but they were duplicates, so the numbers they
-- held are still held by the row that survived.

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
--> statement-breakpoint

-- ----- The logical keys of the table ----------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_daily_aggregates_site_date"
ON "analytics_daily_aggregates" (date)
WHERE content_type IS NULL AND deleted_at IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_daily_aggregates_content_date"
ON "analytics_daily_aggregates" (date, content_type, content_id)
WHERE content_type IS NOT NULL AND deleted_at IS NULL;
