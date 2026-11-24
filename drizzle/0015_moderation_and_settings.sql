CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"boolean_value" boolean,
	"string_value" text,
	"value" jsonb,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_reports" ADD COLUMN "review_id_snapshot" uuid;
--> statement-breakpoint
UPDATE "review_reports" SET "review_id_snapshot" = "review_id" WHERE "review_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "review_reports" ALTER COLUMN "review_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "review_reports" DROP CONSTRAINT "fk_review_reports_review_id";
--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "fk_review_reports_review_id" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "ck_review_reports_review_reference" CHECK ("review_reports"."review_id" is not null or "review_reports"."review_id_snapshot" is not null);
--> statement-breakpoint
DROP INDEX IF EXISTS "uq_review_reports_user_id_review_id_active";
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_review_reports_user_id_review_id_active" ON "review_reports" USING btree ("user_id","review_id") WHERE "review_reports"."status" = 'active' and "review_reports"."review_id" is not null;
--> statement-breakpoint
CREATE INDEX "idx_review_reports_review_id_snapshot" ON "review_reports" USING btree ("review_id_snapshot");
--> statement-breakpoint
CREATE INDEX "idx_moderation_actions_target_id" ON "moderation_actions" USING btree ("target_id");
--> statement-breakpoint
CREATE INDEX "idx_moderation_actions_actor_user_id" ON "moderation_actions" USING btree ("actor_user_id");
--> statement-breakpoint
CREATE INDEX "idx_moderation_actions_created_at" ON "moderation_actions" USING btree ("created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_system_settings_key" ON "system_settings" USING btree ("key");
--> statement-breakpoint
CREATE INDEX "idx_system_settings_updated_by" ON "system_settings" USING btree ("updated_by");
--> statement-breakpoint
-- Cross-module foreign keys.
--
-- These cannot be declared in the Drizzle schema: a module may not import
-- another module's `schema.ts`. `users` belongs to `auth`; `moderation_actions`
-- and `system_settings` belong to `moderation` and `administration`.
--
-- Deletion behaviour:
--   - A moderation audit row outlives the administrator: deleting a viewer
--     account sets `actor_user_id` to NULL instead of deleting the audit
--     trail. The column stays nullable in the database even though the
--     application always writes an actor.
--   - A system setting outlives the administrator who last changed it.
ALTER TABLE "moderation_actions" ALTER COLUMN "actor_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "fk_moderation_actions_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "fk_system_settings_updated_by" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action NOT VALID;
