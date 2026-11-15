-- Prompt 068: normalize content publication state.
-- Backfill first: existing NULL values and legacy episode 'ongoing'/'completed'
-- lifecycle values become 'draft'. This preserves drama content status, which
-- lives in the separate "status" column, and never touches other metadata.
UPDATE "dramas" SET "publication_status" = 'draft' WHERE "publication_status" IS NULL OR "publication_status" NOT IN ('draft', 'published', 'unpublished');--> statement-breakpoint
UPDATE "seasons" SET "publication_status" = 'draft' WHERE "publication_status" IS NULL OR "publication_status" NOT IN ('draft', 'published', 'unpublished');--> statement-breakpoint
UPDATE "episodes" SET "publication_status" = 'draft' WHERE "publication_status" IS NULL OR "publication_status" NOT IN ('draft', 'published', 'unpublished');--> statement-breakpoint
UPDATE "movies" SET "publication_status" = 'draft' WHERE "publication_status" IS NULL OR "publication_status" NOT IN ('draft', 'published', 'unpublished');--> statement-breakpoint
ALTER TABLE "dramas" ALTER COLUMN "publication_status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "dramas" ALTER COLUMN "publication_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ALTER COLUMN "publication_status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "episodes" ALTER COLUMN "publication_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ALTER COLUMN "publication_status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "movies" ALTER COLUMN "publication_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ALTER COLUMN "publication_status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "seasons" ALTER COLUMN "publication_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dramas" ADD CONSTRAINT "ck_dramas_publication_status" CHECK ("dramas"."publication_status" in ('draft', 'published', 'unpublished'));--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "ck_episodes_publication_status" CHECK ("episodes"."publication_status" in ('draft', 'published', 'unpublished'));--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "ck_movies_publication_status" CHECK ("movies"."publication_status" in ('draft', 'published', 'unpublished'));--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "ck_seasons_publication_status" CHECK ("seasons"."publication_status" in ('draft', 'published', 'unpublished'));
