-- 0031_phase13_system_setting_versions.sql
-- Configuration version history table

CREATE TABLE "system_setting_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"setting_key" text NOT NULL,
	"setting_description" text,
	"previous_value" jsonb,
	"new_value" jsonb,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version_comment" text
);

-- Index for looking up history by setting key
CREATE INDEX "idx_system_setting_versions_setting_key" ON "system_setting_versions" (setting_key);
CREATE INDEX "idx_system_setting_versions_changed_at" ON "system_setting_versions" (changed_at DESC);
CREATE INDEX "idx_system_setting_versions_changed_by" ON "system_setting_versions" (changed_by);

-- Comment: Records configuration changes with before/after values.
-- Rollback creates a new entry rather than deleting history.