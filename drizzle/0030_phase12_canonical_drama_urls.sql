-- Migration 0030 — Phase 12: Canonical drama and movie URLs
-- Stores stable content IDs with slugs for canonical URL support.
-- When a slug changes, the old URL redirects to the canonical URL.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'drama_status') THEN
    CREATE TYPE "drama_status" AS ENUM ('active', 'inactive', 'trashed');
  END
END
$$;

CREATE TABLE IF NOT EXISTS "dramas" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "slug" text NOT NULL,
  "stable_id" text NOT NULL,
  "title" text NOT NULL,
  "status" "drama_status" NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  CONSTRAINT "dramas_slug_key" UNIQUE ("slug"),
  CONSTRAINT "dramas_stable_id_key" UNIQUE ("stable_id")
);

-- Trigger for updated_at
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."dramas_updated_at_trigger()"
RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE TRIGGER "dramas_updated_at_trigger"
BEFORE UPDATE ON "dramas"
FOR EACH ROW EXECUTE FUNCTION "public"."dramas_updated_at_trigger";

-- Index for slug-based lookup
CREATE INDEX IF NOT EXISTS "idx_dramas_slug" ON "dramas" ("slug" text_pattern_ops);

-- Index for stable_id-based lookup (canonical URL)
CREATE INDEX IF NOT EXISTS "idx_dramas_stable_id" ON "dramas" ("stable_id" text_pattern_ops);

-- Comment
COMMENT ON TABLE "dramas" IS
'Stores dramas with stable_id for canonical URL support (/drama/{stable_id}/{slug}). Status controls public accessibility.';