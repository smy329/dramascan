-- Migration 0013 — video source workflow tables
--
-- Creates the administrative audit trail, the playback failure reports, and the
-- subtitle tracks.
--
-- Reversible: the rollback drops the three tables, their indexes, and the
-- cross-module foreign keys. The audit trail and the failure reports are lost
-- with the tables.

CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playback_failure_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"episode_id" uuid NOT NULL,
	"reported_by" uuid,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subtitle_tracks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"episode_id" uuid NOT NULL,
	"language" text NOT NULL,
	"label" text NOT NULL,
	"source_url" text NOT NULL,
	"format" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_admin_audit_log_entity_type_entity_id" ON "admin_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_log_actor_id" ON "admin_audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_log_created_at" ON "admin_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_playback_failure_reports_episode_id_created_at" ON "playback_failure_reports" USING btree ("episode_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_playback_failure_reports_created_at" ON "playback_failure_reports" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_playback_failure_reports_reported_by" ON "playback_failure_reports" USING btree ("reported_by");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subtitle_tracks_episode_id_language" ON "subtitle_tracks" USING btree ("episode_id","language");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subtitle_tracks_episode_id_default" ON "subtitle_tracks" USING btree ("episode_id") WHERE "subtitle_tracks"."is_default";--> statement-breakpoint
CREATE INDEX "idx_subtitle_tracks_episode_id" ON "subtitle_tracks" USING btree ("episode_id");--> statement-breakpoint
-- Cross-module foreign keys.
--
-- These cannot be declared in the Drizzle schema: a module may not import
-- another module's `schema.ts`. `episodes` belongs to `content`, `users`
-- belongs to `auth`, and the tables below belong to `playback` and
-- `administration`.
--
-- Deletion behaviour:
--   - Subtitle tracks and failure reports are subordinate to their episode:
--     they describe how an episode presents, so a permanent episode deletion
--     removes them with it.
--   - A failure report outlives the reporter: deleting a viewer account sets
--     `reported_by` to NULL instead of deleting the operational record or
--     blocking the account deletion.
ALTER TABLE "subtitle_tracks" ADD CONSTRAINT "fk_subtitle_tracks_episode_id" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_failure_reports" ADD CONSTRAINT "fk_playback_failure_reports_episode_id" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_failure_reports" ADD CONSTRAINT "fk_playback_failure_reports_reported_by" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "fk_admin_audit_log_actor_id" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action NOT VALID;