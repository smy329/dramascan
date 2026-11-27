CREATE TABLE "structure_conversion_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"drama_id" uuid NOT NULL,
	"source_structure_type" text DEFAULT 'season_based' NOT NULL,
	"target_structure_type" text DEFAULT 'flat' NOT NULL,
	"season_data" jsonb NOT NULL,
	"episode_data" jsonb NOT NULL,
	"post_conversion_fingerprint" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"restored_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_structure_conversion_snapshots_status" CHECK ("structure_conversion_snapshots"."status" in ('available', 'restored', 'superseded')),
	CONSTRAINT "ck_structure_conversion_snapshots_direction" CHECK ("structure_conversion_snapshots"."source_structure_type" = 'season_based' and "structure_conversion_snapshots"."target_structure_type" = 'flat')
);
--> statement-breakpoint
ALTER TABLE "structure_conversion_snapshots" ADD CONSTRAINT "fk_structure_conversion_snapshots_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_structure_conversion_snapshots_drama_id" ON "structure_conversion_snapshots" USING btree ("drama_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_structure_conversion_snapshots_drama_id_available" ON "structure_conversion_snapshots" USING btree ("drama_id") WHERE "structure_conversion_snapshots"."status" = 'available';