ALTER TABLE "episodes" ADD COLUMN "video_source_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Cross-module foreign keys: the deletion behaviour changes.
--
-- `subtitle_tracks` and `playback_failure_reports` belong to the `playback`
-- module, and `episodes` belongs to `content`. A cascading delete would let a
-- content deletion remove another module's rows without that module's
-- knowledge, so the constraint now refuses the deletion instead. The
-- permanent-delete workflow removes the playback rows explicitly, through the
-- playback module's own service, and only then deletes the episode.
ALTER TABLE "subtitle_tracks" DROP CONSTRAINT "fk_subtitle_tracks_episode_id";
--> statement-breakpoint
ALTER TABLE "subtitle_tracks" ADD CONSTRAINT "fk_subtitle_tracks_episode_id" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "playback_failure_reports" DROP CONSTRAINT "fk_playback_failure_reports_episode_id";
--> statement-breakpoint
ALTER TABLE "playback_failure_reports" ADD CONSTRAINT "fk_playback_failure_reports_episode_id" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
