-- Migration 0008 — drama visibility and the permission resource rename
--
-- Reversible: the rollback drops the `visibility` column and restores the
-- previous permission-key constraint. The permission resource rename is not
-- reversible by a rollback of this migration alone: the renamed rows would
-- have to be changed back to `similar-drama`, which the next permission
-- constraint no longer accepts.

ALTER TABLE "permissions" DROP CONSTRAINT "ck_permissions_permission_key";--> statement-breakpoint
UPDATE "permissions" SET "resource" = 'similar_drama' WHERE "resource" = 'similar-drama';--> statement-breakpoint
ALTER TABLE "dramas" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'coming_soon';--> statement-breakpoint
ALTER TABLE "dramas" ALTER COLUMN "visibility" SET DEFAULT 'coming_soon';--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "ck_permissions_permission_key" CHECK (("permissions"."resource" || '.' || "permissions"."action") in ('drama.create', 'drama.read', 'drama.update', 'drama.delete', 'drama.manage', 'movie.create', 'movie.read', 'movie.update', 'movie.delete', 'movie.manage', 'episode.create', 'episode.read', 'episode.update', 'episode.delete', 'episode.manage', 'season.read', 'season.create', 'season.update', 'season.delete', 'season.manage', 'category.create', 'category.read', 'category.update', 'category.delete', 'category.manage', 'platform.create', 'platform.read', 'platform.update', 'platform.delete', 'platform.manage', 'user.read', 'user.manage', 'review.create', 'review.read', 'review.delete', 'review.manage', 'rating.read', 'rating.manage', 'analytics.read', 'analytics.manage', 'settings.read', 'settings.manage', 'admin.manage', 'similar_drama.manage'));
