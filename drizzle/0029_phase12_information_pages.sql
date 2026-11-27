-- Migration 0029 — Phase 12: Information pages
--
-- Stores administrator-managed legal and information pages.
-- Each page has a slug, publication status, and SEO metadata.
--

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'information_page_status') THEN
    CREATE TYPE "information_page_status" AS ENUM ('draft', 'published', 'trashed');
  END
END
$$;

CREATE TABLE IF NOT EXISTS "information_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"seo_title" text,
	"seo_description" text,
	"status" "information_page_status" NOT NULL DEFAULT 'draft',
	"footer_visible" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	 CONSTRAINT "information_pages_slug_key" UNIQUE ("slug")
);

--> statement-breakpoint
COMMENT ON TABLE "information_pages" IS
'Admin-managed legal and information pages. Slug-based routing. Status controls
public accessibility. Footer visibility is independent of publication status.';

--> statement-breakpoint
COMMENT ON COLUMN "information_pages".status IS
' draft: not visible publicly, only to admins
 published: publicly accessible
 trashed: soft-deleted, recoverable';

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."information_pages_updated_at_trigger()"
RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE TRIGGER "information_pages_updated_at_trigger"
BEFORE UPDATE ON "information_pages"
FOR EACH ROW EXECUTE FUNCTION "public"."information_pages_updated_at_trigger()";