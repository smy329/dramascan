-- Migration 0028 — Phase 12: Admin dashboard preferences
--
-- Stores global default dashboard layouts (Super Admin) and personal
-- administrator preferences. Uses JSONB for the layout payload.
--

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_dashboard_preference_scope') THEN
    CREATE TYPE "admin_dashboard_preference_scope" AS ENUM ('global', 'user');
  END
$$;

CREATE TABLE IF NOT EXISTS "admin_dashboard_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scope" "admin_dashboard_preference_scope" NOT NULL,
	"user_id" uuid,
	"layout" jsonb NOT NULL DEFAULT '{"widgets": []}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_dashboard_preferences_scope_global"
ON "admin_dashboard_preferences" ("scope")
WHERE "scope" = 'global';

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_dashboard_preferences_scope_user"
ON "admin_dashboard_preferences" ("user_id")
WHERE "scope" = 'user';

--> statement-breakpoint

ALTER TABLE "admin_dashboard_preferences"
  ADD CONSTRAINT "fk_admin_dashboard_preferences_user"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action NOT VALID;

--> statement-breakpoint
COMMENT ON TABLE "admin_dashboard_preferences" IS
'Stores global dashboard default layouts (scope = global, user_id = NULL) and
per-administrator personal preferences (scope = user, user_id = authenticated admin id).
Only one global record may exist; each authenticated administrator may have at most one
personal record.';

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."admin_dashboard_preferences_trigger()"
RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE TRIGGER "admin_dashboard_preferences_updated_at_trigger"
BEFORE UPDATE ON "admin_dashboard_preferences"
FOR EACH ROW EXECUTE FUNCTION "public"."admin_dashboard_preferences_trigger()";

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_dashboard_preferences_user_id"
ON "admin_dashboard_preferences" ("user_id")
WHERE "scope" = 'user';

-- Reversible: the down migration drops the two columns and the ENUM type if
-- no other table references it. The migration is safe to re-apply because it
-- uses IF NOT EXISTS / IF EXISTS guards.