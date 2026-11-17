-- Migration 0009 — content integrity, typed user-content targets, published_at
--
-- Covers H-08 (hierarchy/taxonomy foreign keys and scoped uniqueness), H-09
-- (typed drama/movie targets on user-content tables), M-07 (rating range, review
-- reaction/report integrity, report lifecycle) and SCOPE-D01 (`published_at`).
--
-- Reversibility: forward-fix-only. Nothing is dropped and no column that holds
-- data is narrowed, so the previous application release keeps working against
-- this schema. If the release must be rolled back, the additive objects stay;
-- dropping them would be a separate, explicitly approved migration.
--
-- Safety posture for a populated database:
--   * Foreign keys and CHECK constraints are added `NOT VALID`. PostgreSQL then
--     verifies them for every new or updated row while tolerating pre-existing
--     rows, so this migration cannot abort on legacy data. Validation is a
--     separate, explicit operator step (`npm run db:integrity -- validate`).
--   * Unique indexes are created inside a guarded block. A duplicate that
--     predates this migration is reported instead of failing the migration; the
--     same operator report lists the offending rows.
--   * No data is rewritten and no `published_at` value is invented; see
--     docs/development/DATA_INTEGRITY.md for the reconciliation procedure.

-- 1. First-publication timestamps (SCOPE-D01). Nullable for existing rows: an
--    already-published row has no trustworthy publication instant, so it stays
--    null and readers order by `published_at desc nulls last, created_at desc`.
ALTER TABLE "dramas" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint

-- 2. Report lifecycle (M-07). Existing reports were all awaiting moderation, so
--    `active` is the truthful default rather than an invented state.
ALTER TABLE "review_reports" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_reports" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_reports" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- 3. Typed user-content targets (H-09), expand only. The legacy
--    `content_type`/`content_id` pair stays: some rows may only be interpretable
--    through it, and the reconciliation path still needs it. Backfill runs
--    separately and only for unambiguous rows.
ALTER TABLE "bookmarks" ADD COLUMN "drama_id" uuid;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "movie_id" uuid;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD COLUMN "drama_id" uuid;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD COLUMN "movie_id" uuid;--> statement-breakpoint
ALTER TABLE "watch_history" ADD COLUMN "drama_id" uuid;--> statement-breakpoint
ALTER TABLE "watch_history" ADD COLUMN "movie_id" uuid;--> statement-breakpoint
ALTER TABLE "watched_state" ADD COLUMN "drama_id" uuid;--> statement-breakpoint
ALTER TABLE "watched_state" ADD COLUMN "movie_id" uuid;--> statement-breakpoint

-- 4. The composite episode → season target must exist before the foreign key
--    that references it. It is always satisfiable because `seasons.id` is
--    already unique, so this one constraint is validated immediately.
ALTER TABLE "seasons" ADD CONSTRAINT "uq_seasons_drama_id_id" UNIQUE("drama_id","id");--> statement-breakpoint

-- 5. Same-module foreign keys (declared in the Drizzle schema), added NOT VALID.
ALTER TABLE "drama_categories" ADD CONSTRAINT "fk_drama_categories_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "drama_categories" ADD CONSTRAINT "fk_drama_categories_category_id" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "drama_platforms" ADD CONSTRAINT "fk_drama_platforms_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "drama_platforms" ADD CONSTRAINT "fk_drama_platforms_platform_id" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "fk_episodes_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "fk_episodes_drama_id_season_id" FOREIGN KEY ("drama_id","season_id") REFERENCES "public"."seasons"("drama_id","id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "movie_categories" ADD CONSTRAINT "fk_movie_categories_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "movie_categories" ADD CONSTRAINT "fk_movie_categories_category_id" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "movie_platforms" ADD CONSTRAINT "fk_movie_platforms_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "movie_platforms" ADD CONSTRAINT "fk_movie_platforms_platform_id" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "fk_seasons_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "similar_dramas" ADD CONSTRAINT "fk_similar_dramas_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "similar_dramas" ADD CONSTRAINT "fk_similar_dramas_similar_drama_id" FOREIGN KEY ("similar_drama_id") REFERENCES "public"."dramas"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "review_reactions" ADD CONSTRAINT "fk_review_reactions_review_id" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "fk_review_reports_review_id" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint

-- 6. Cross-module foreign keys. These cannot be declared in the Drizzle schema
--    because a module may not import another module's `schema.ts`; the review,
--    authorization, and user schemas reference `users`/`dramas`/`movies`/
--    `episodes` from SQL only. All are NOT VALID for the same reason as above.
--    Content targets use `restrict`: permanently removing content must never
--    silently erase a person's bookmarks or viewing history.
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "review_reactions" ADD CONSTRAINT "fk_review_reactions_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "fk_review_reports_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "fk_bookmarks_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "fk_bookmarks_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "fk_bookmarks_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "fk_playback_progress_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "fk_playback_progress_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "fk_playback_progress_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "fk_playback_progress_episode_id" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "watched_state" ADD CONSTRAINT "fk_watched_state_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "watched_state" ADD CONSTRAINT "fk_watched_state_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "watched_state" ADD CONSTRAINT "fk_watched_state_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "watched_state" ADD CONSTRAINT "fk_watched_state_episode_id" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "fk_watch_history_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "fk_watch_history_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "fk_watch_history_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "fk_watch_history_episode_id" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint

-- 7. CHECK constraints that describe real rules. `NOT VALID` where legacy rows
--    may already violate them: a rating outside 1–5, or a user-content row that
--    names no typed target.
ALTER TABLE "ratings" ADD CONSTRAINT "ck_ratings_value_range" CHECK ("ratings"."value" between 1 and 5) NOT VALID;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "ck_bookmarks_target" CHECK (("bookmarks"."drama_id" is not null and "bookmarks"."movie_id" is null) or ("bookmarks"."drama_id" is null and "bookmarks"."movie_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "ck_playback_progress_target" CHECK (("playback_progress"."drama_id" is not null and "playback_progress"."movie_id" is null) or ("playback_progress"."drama_id" is null and "playback_progress"."movie_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "ck_watch_history_target" CHECK (("watch_history"."drama_id" is not null and "watch_history"."movie_id" is null) or ("watch_history"."drama_id" is null and "watch_history"."movie_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "watched_state" ADD CONSTRAINT "ck_watched_state_target" CHECK (("watched_state"."drama_id" is not null and "watched_state"."movie_id" is null) or ("watched_state"."drama_id" is null and "watched_state"."movie_id" is not null)) NOT VALID;--> statement-breakpoint

-- The report status column is new and defaulted, so every existing row already
-- satisfies the vocabulary. This constraint is fully validated from the start.
ALTER TABLE "review_reports" ADD CONSTRAINT "ck_review_reports_status" CHECK ("review_reports"."status" in ('active', 'resolved'));--> statement-breakpoint

-- 8. Plain indexes for the foreign-key and listing query patterns.
CREATE INDEX "idx_categories_position" ON "categories" USING btree ("position");--> statement-breakpoint
CREATE INDEX "idx_drama_categories_category_id" ON "drama_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_drama_platforms_platform_id" ON "drama_platforms" USING btree ("platform_id");--> statement-breakpoint
CREATE INDEX "idx_dramas_publication_status_created_at" ON "dramas" USING btree ("publication_status","created_at");--> statement-breakpoint
CREATE INDEX "idx_episodes_drama_id" ON "episodes" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_episodes_season_id" ON "episodes" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "idx_movie_categories_category_id" ON "movie_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_movie_platforms_platform_id" ON "movie_platforms" USING btree ("platform_id");--> statement-breakpoint
CREATE INDEX "idx_platforms_position" ON "platforms" USING btree ("position");--> statement-breakpoint
CREATE INDEX "idx_seasons_drama_id" ON "seasons" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_similar_dramas_similar_drama_id" ON "similar_dramas" USING btree ("similar_drama_id");--> statement-breakpoint
CREATE INDEX "idx_review_reactions_review_id" ON "review_reactions" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "idx_review_reports_review_id" ON "review_reports" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "idx_bookmarks_user_id" ON "bookmarks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_playback_progress_user_id_last_watched_at" ON "playback_progress" USING btree ("user_id","last_watched_at");--> statement-breakpoint
CREATE INDEX "idx_playback_progress_episode_id" ON "playback_progress" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "idx_watch_history_user_id_watched_at" ON "watch_history" USING btree ("user_id","watched_at");--> statement-breakpoint
CREATE INDEX "idx_watch_history_episode_id" ON "watch_history" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "idx_watched_state_user_id_last_watched_at" ON "watched_state" USING btree ("user_id","last_watched_at");--> statement-breakpoint
CREATE INDEX "idx_watched_state_episode_id" ON "watched_state" USING btree ("episode_id");--> statement-breakpoint

-- 9. Unique indexes. PostgreSQL cannot add a unique constraint `NOT VALID`, so a
--    duplicate that predates this migration would abort the whole migration on a
--    populated database. Each index is therefore created in its own guarded
--    block: a duplicate produces a warning and leaves the report to identify the
--    rows, while every index that can be created is created. New writes are
--    enforced by the indexes that exist and by the workflows, which serialize
--    allocation on the parent row. `npm run db:integrity` lists what was skipped
--    and `npm run db:integrity -- validate` retries the creation once the data is
--    reconciled.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX "uq_dramas_slug_active" ON "dramas" USING btree ("slug") WHERE "dramas"."deleted_at" is null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_dramas_slug_active: duplicate active drama slug. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_categories_slug_active" ON "categories" USING btree ("slug") WHERE "categories"."deleted_at" is null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_categories_slug_active: duplicate active category slug. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_platforms_slug_active" ON "platforms" USING btree ("slug") WHERE "platforms"."deleted_at" is null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_platforms_slug_active: duplicate active platform slug. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_episodes_drama_id_episode_number_active" ON "episodes" USING btree ("drama_id","episode_number") WHERE "episodes"."deleted_at" is null and "episodes"."episode_number" is not null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_episodes_drama_id_episode_number_active: duplicate active episode number. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_seasons_drama_id_position_active" ON "seasons" USING btree ("drama_id","position") WHERE "seasons"."deleted_at" is null and "seasons"."position" is not null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_seasons_drama_id_position_active: duplicate active season position. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_review_reactions_user_id_review_id" ON "review_reactions" USING btree ("user_id","review_id");
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_review_reactions_user_id_review_id: duplicate reaction. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_review_reports_user_id_review_id_active" ON "review_reports" USING btree ("user_id","review_id") WHERE "review_reports"."status" = 'active';
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_review_reports_user_id_review_id_active: duplicate active report. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_bookmarks_user_id_drama_id" ON "bookmarks" USING btree ("user_id","drama_id") WHERE "bookmarks"."drama_id" is not null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_bookmarks_user_id_drama_id: duplicate bookmark. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_bookmarks_user_id_movie_id" ON "bookmarks" USING btree ("user_id","movie_id") WHERE "bookmarks"."movie_id" is not null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_bookmarks_user_id_movie_id: duplicate bookmark. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_playback_progress_user_id_episode_id" ON "playback_progress" USING btree ("user_id","episode_id") WHERE "playback_progress"."episode_id" is not null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_playback_progress_user_id_episode_id: duplicate progress row. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_playback_progress_user_id_movie_id" ON "playback_progress" USING btree ("user_id","movie_id") WHERE "playback_progress"."movie_id" is not null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_playback_progress_user_id_movie_id: duplicate progress row. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_watched_state_user_id_episode_id" ON "watched_state" USING btree ("user_id","episode_id") WHERE "watched_state"."episode_id" is not null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_watched_state_user_id_episode_id: duplicate watched-state row. See docs/development/DATA_INTEGRITY.md';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_watched_state_user_id_movie_id" ON "watched_state" USING btree ("user_id","movie_id") WHERE "watched_state"."movie_id" is not null;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'skipped uq_watched_state_user_id_movie_id: duplicate watched-state row. See docs/development/DATA_INTEGRITY.md';
  END;
END;
$$;
