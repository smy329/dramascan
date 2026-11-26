-- Migration 0024 — Phase 11 review fixes, round 4 (notification preference)
--
-- Migration 0018 added the independent `new_drama` switch to the notification
-- preference row, but it added it as a nullable column. The data model
-- (DATABASE.md §8.9) defines it as `boolean NOT NULL DEFAULT true`, and a
-- switch that can be null is a switch whose meaning depends on the reader:
-- one query reads `null` as "off" and another reads it as "on".
--
-- The backfill is idempotent: running it twice writes the same values. A row
-- whose switch is null is a row that never made a choice, so the default,
-- "on", is the value that matches the rest of the row.
--
-- Reversible: the rollback drops the NOT NULL constraint. It cannot restore
-- the nulls the backfill replaced, because a null and the default "on" are
-- the same stored preference.

UPDATE "notification_preferences" SET "new_drama" = true WHERE "new_drama" IS NULL;
--> statement-breakpoint

ALTER TABLE "notification_preferences" ALTER COLUMN "new_drama" SET DEFAULT true;
--> statement-breakpoint

ALTER TABLE "notification_preferences" ALTER COLUMN "new_drama" SET NOT NULL;
