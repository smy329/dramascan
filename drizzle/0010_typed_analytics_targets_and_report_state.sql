-- Migration 0010 — typed analytics targets and full review-report state
--
-- Extends migration 0009 with the two corrections the Phase 4 audit produced:
--
--   * H-09 — the analytics tables get the same typed drama/movie targets the
--     user-content tables received in 0009. `content_view_events` and
--     `playback_analytics_events` name exactly one content item; a daily
--     aggregate may be site-wide, so it may name none, but never both.
--   * M-07 — a review report records its full state: an optional description,
--     the moderator who resolved it, the outcome, the submission time, and a
--     lifecycle rule that ties those fields together.
--
-- 0009 is already applied to the development and test databases, so this is a
-- forward migration. It only adds columns, constraints, and indexes; no column
-- is dropped, renamed, or narrowed, and no data is rewritten.
--
-- Safety posture for a populated database:
--   * Foreign keys and CHECK constraints are added `NOT VALID`. PostgreSQL then
--     verifies them for every new or updated row while tolerating pre-existing
--     rows, so this migration cannot abort on legacy data. Validation is a
--     separate, explicit operator step (`npm run db:integrity -- validate`).
--   * `reported_at` is added as a nullable column and only afterwards given a
--     default. Adding it with the default in one statement would give every
--     legacy report the migration time as its submission date, which is a
--     fabricated date.
--   * The report → review foreign key is replaced with a `restrict` version, so
--     permanently removing a review that has reports is blocked instead of
--     silently deleting the moderation history.
--
-- Reversible: the rollback drops the indexes, the constraints, and the columns
-- this migration adds. The rows stay, but the typed target of an analytics row
-- and the resolution record of a report are lost with the columns.

-- 1. Typed analytics targets (H-09). The legacy `content_type`/`content_id`
--    pair stays: it is still the only evidence for rows the backfill cannot
--    place, and it is rewritten in step with the typed target by the drama →
--    movie conversion.
ALTER TABLE "content_view_events" ADD COLUMN "drama_id" uuid;--> statement-breakpoint
ALTER TABLE "content_view_events" ADD COLUMN "movie_id" uuid;--> statement-breakpoint
ALTER TABLE "playback_analytics_events" ADD COLUMN "drama_id" uuid;--> statement-breakpoint
ALTER TABLE "playback_analytics_events" ADD COLUMN "movie_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics_daily_aggregates" ADD COLUMN "drama_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics_daily_aggregates" ADD COLUMN "movie_id" uuid;--> statement-breakpoint

-- 2. Full report state (M-07).
ALTER TABLE "review_reports" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "review_reports" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "review_reports" ADD COLUMN "resolution_outcome" text;--> statement-breakpoint
--    Legacy reports keep a null submission time: their real one is unknowable.
ALTER TABLE "review_reports" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER COLUMN "reported_at" SET DEFAULT now();--> statement-breakpoint

-- 3. Report → review foreign key. `0009` created it with `ON DELETE CASCADE`,
--    which erased the moderation history when a review was permanently removed.
--    The replacement keeps the history: the deletion is blocked instead.
ALTER TABLE "review_reports" DROP CONSTRAINT "fk_review_reports_review_id";--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "fk_review_reports_review_id" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint

-- 4. Cross-module foreign keys. They cannot be declared in the Drizzle schema
--    because a module may not import another module's `schema.ts`. All are NOT
--    VALID for the same reason as in 0009.
ALTER TABLE "content_view_events" ADD CONSTRAINT "fk_content_view_events_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "content_view_events" ADD CONSTRAINT "fk_content_view_events_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_analytics_events" ADD CONSTRAINT "fk_playback_analytics_events_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_analytics_events" ADD CONSTRAINT "fk_playback_analytics_events_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "analytics_daily_aggregates" ADD CONSTRAINT "fk_analytics_daily_aggregates_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "analytics_daily_aggregates" ADD CONSTRAINT "fk_analytics_daily_aggregates_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
--    A moderator is a user. `restrict` keeps the resolution record readable
--    even if the account is later removed.
ALTER TABLE "review_reports" ADD CONSTRAINT "fk_review_reports_resolved_by" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint

-- 5. CHECK constraints. `NOT VALID` where legacy rows may already violate them:
--    an analytics row without a typed target, or a report whose resolution
--    record is incomplete.
ALTER TABLE "content_view_events" ADD CONSTRAINT "ck_content_view_events_target" CHECK (("content_view_events"."drama_id" is not null and "content_view_events"."movie_id" is null) or ("content_view_events"."drama_id" is null and "content_view_events"."movie_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_analytics_events" ADD CONSTRAINT "ck_playback_analytics_events_target" CHECK (("playback_analytics_events"."drama_id" is not null and "playback_analytics_events"."movie_id" is null) or ("playback_analytics_events"."drama_id" is null and "playback_analytics_events"."movie_id" is not null)) NOT VALID;--> statement-breakpoint
--    A daily aggregate may be site-wide, so both targets may be null; naming a
--    drama and a movie at the same time is always wrong.
ALTER TABLE "analytics_daily_aggregates" ADD CONSTRAINT "ck_analytics_daily_aggregates_target" CHECK ("analytics_daily_aggregates"."drama_id" is null or "analytics_daily_aggregates"."movie_id" is null) NOT VALID;--> statement-breakpoint
--    An active report carries no resolution record; a resolved report carries a
--    complete one.
ALTER TABLE "review_reports" ADD CONSTRAINT "ck_review_reports_lifecycle" CHECK ((
        "review_reports"."status" = 'active'
        and "review_reports"."resolved_at" is null
        and "review_reports"."resolved_by" is null
        and "review_reports"."resolution_outcome" is null
      ) or (
        "review_reports"."status" = 'resolved'
        and "review_reports"."resolved_at" is not null
        and "review_reports"."resolved_by" is not null
        and "review_reports"."resolution_outcome" is not null
      )) NOT VALID;--> statement-breakpoint

-- 6. Plain indexes for the foreign-key and listing query patterns.
CREATE INDEX "idx_analytics_daily_aggregates_drama_id" ON "analytics_daily_aggregates" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_analytics_daily_aggregates_movie_id" ON "analytics_daily_aggregates" USING btree ("movie_id");--> statement-breakpoint
CREATE INDEX "idx_content_view_events_drama_id" ON "content_view_events" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_content_view_events_movie_id" ON "content_view_events" USING btree ("movie_id");--> statement-breakpoint
CREATE INDEX "idx_playback_analytics_events_drama_id" ON "playback_analytics_events" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_playback_analytics_events_movie_id" ON "playback_analytics_events" USING btree ("movie_id");--> statement-breakpoint
CREATE INDEX "idx_review_reports_resolved_by" ON "review_reports" USING btree ("resolved_by");--> statement-breakpoint
