-- Search indexes.
--
-- The public search page matches a title three ways (see
-- `src/modules/analytics/read-models/discovery.ts`):
--
--   - a plain `ILIKE` pattern,
--   - a PostgreSQL full-text match on the `simple` text-search configuration,
--   - a trigram similarity match, which catches near misses and typos.
--
-- The first two are served by the indexes below. The third needs the
-- `pg_trgm` extension, which provides the `similarity()` function and the
-- `gin_trgm_ops` operator class.
--
-- `pg_trgm` is a trusted extension: a database owner can install it without
-- superuser rights, so this migration does not need elevated privileges.
--
-- The expression indexes are on `to_tsvector('simple', title)` rather than on
-- the default configuration, because the queries use the `simple`
-- configuration. An index built on the default configuration would not match
-- the query and PostgreSQL would fall back to a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dramas_title_trgm" ON "dramas" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_movies_title_trgm" ON "movies" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_categories_name_trgm" ON "categories" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platforms_name_trgm" ON "platforms" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dramas_title_fts" ON "dramas" USING gin (to_tsvector('simple', "title"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_movies_title_fts" ON "movies" USING gin (to_tsvector('simple', "title"));
