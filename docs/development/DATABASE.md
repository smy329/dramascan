# DATABASE

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Document:** Database schema, relationships, and migration notes
**Version:** 1.0
**Date:** 2026-11-08
**Status:** Applied. The modular schema structure, all 42 tables, and the initial Drizzle baseline migration are implemented. `drizzle/0000_boring_harry_osborn.sql` has been applied to the local `dramascan` database and is the baseline for every environment.

**Authority chain:** `AGENTS.md` → `REQUIREMENTS.md` → `DECISIONS.md` → `ARCHITECTURE.md` → `CONVENTIONS.md` → this document.

This document is the source of truth for the implemented database. The table catalog below records the implemented schema.

---

## 1. Status

| Item                   | Status                                       |
| ---------------------- | -------------------------------------------- |
| PostgreSQL connection  | Configured (Prompt 019)                      |
| Drizzle schema modules | Implemented, 42 tables (Prompts 020–029)     |
| Migrations             | Configured and applied (Prompt 040)          |
| Tables                 | 42 implemented (see §8)                      |
| Seed data              | Reference data only; no seed command yet     |
| Test database          | Builds from migrations (`TEST_DATABASE_URL`) |

Do not describe planned tables as existing. Update this document when each schema module is implemented.

---

## 2. Conventions

Database naming, keys, timestamps, soft deletion, constraints, indexes, and ownership are defined in `CONVENTIONS.md` §5. The rules below are the database-specific application of those conventions.

### 2.1 Core rules

- Tables and columns are `snake_case`; tables are plural.
- Primary keys are `id uuid` using UUIDv7 for application-owned tables.
- Foreign keys are `<singular_table>_id`.
- Timestamps are `timestamptz`, stored and compared in UTC.
- Trash is `deleted_at timestamptz null`; publication status is a separate enum.
- Every foreign key is indexed.
- Every production list query has a supporting index.
- Each table is owned by exactly one module and written only by that module.
- Cross-module reads use the owner's public query API or an approved read model.
- Cross-module foreign keys are declared in SQL migrations, not by importing another module's `schema.ts`.
- No table stores credentials, plaintext secrets, or unnecessary Google profile data.

### 2.2 Standard columns

Most application-owned tables include:

| Column       | Type          | Notes                                                 |
| ------------ | ------------- | ----------------------------------------------------- |
| `id`         | `uuid`        | Primary key, UUIDv7, server-generated                 |
| `created_at` | `timestamptz` | `not null default now()`                              |
| `updated_at` | `timestamptz` | `not null default now()`, set by repository on update |
| `deleted_at` | `timestamptz` | `null` unless soft-deleted                            |

Additional columns are table-specific and documented in the catalog.

### 2.3 Connection management (Prompt 019)

- `src/platform/db/pool.ts` owns the single server-only `pg.Pool`. `src/db/client.ts` creates the Drizzle client from that pool.
- `DATABASE_URL` is read from the server environment (Next.js loads `.env.local` in development) and validated by `src/platform/config` with Zod. The value must use `postgres` or `postgresql`, include a hostname and database name, and contain no fragment. It is never exposed through `NEXT_PUBLIC_*` variables.
- Missing configuration throws a safe `ConfigurationError` when the pool is initialized. Error messages name the variable, never its value or password.
- Pool limits are conservative and fixed: maximum 5 connections, minimum 0, 5-second connection timeout, 30-second idle timeout, 30-minute maximum connection lifetime, 5,000 maximum uses per connection, 15-second statement/query timeouts, 30-second idle-in-transaction timeout, and 10-second TCP keepalive.
- `pg` reconnects lazily when a connection is checked out; there is no retry loop, background worker, or queue.
- Idle-client errors are handled on the pool and logged through Pino with connection strings, passwords, and URL credentials redacted.
- PostgreSQL must remain reachable only through the application server's local or private interface. Public exposure is forbidden; local-only access and database role separation are deployment prerequisites, not application features.

### 2.4 Schema composition (Prompt 020)

- Each domain module owns its Drizzle tables in `src/modules/<domain>/schema.ts`. A module's schema file must not import another module's schema file.
- `src/db/schema.ts` is the only file allowed to import module schema files. It spreads each module namespace into one `schema` registry, and `src/db/client.ts` passes that registry to `drizzle(getPool(), { schema })`.
- Shared schema primitives live in `src/platform/db/schema-helpers.ts`: UUIDv7 application primary keys, standard `created_at`/`updated_at`/`deleted_at` columns, and the `pk_`/`fk_`/`uq_`/`ck_`/`idx_` naming helpers from `CONVENTIONS.md` §5.4.
- Application-owned IDs default to PostgreSQL `uuidv7()` on the server through `id uuid PRIMARY KEY DEFAULT uuidv7()`. This requires PostgreSQL 18 or newer; CI and local development use PostgreSQL 18. Better Auth-managed tables use the same `uuidv7()` default: the Drizzle pg adapter reports `supportsUUIDs: true`, so Better Auth relies on the database default instead of generating UUIDs itself. Foreign keys to the auth user table use `uuid`.
- Intra-module foreign keys use named Drizzle constraints. Cross-module foreign keys are added as SQL constraints in migrations and are not declared in `schema.ts`; they do not grant write permission.
- The registry assembles all 11 module schema namespaces and backs the applied baseline migration. No module directory gains service, query, or repository files until that module's implementation prompt.

---

## 3. Ownership Map

Each module owns its schema file and tables. The planned ownership is:

| Module           | Planned tables                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`           | `users`, `accounts`, `sessions`, `verifications` (Better Auth schema plus account status)                                                                                                                                                                                |
| `authorization`  | `roles`, `permissions`, `user_roles`                                                                                                                                                                                                                                     |
| `content`        | `dramas`, `seasons`, `episodes`, `movies`, `categories`, `platforms`, `drama_categories`, `drama_platforms`, `movie_categories`, `movie_platforms`, `similar_dramas`, `information_pages`, `content_slug_history`, `content_seo`, `content_assets`, `sitemap_exclusions` |
| `users`          | `bookmarks`, `playback_progress`, `watched_state`, `watch_history` (the last three are the target `playback` tables; the ownership refactor is tracked in D-040)                                                                                  |
| `playback`       | `subtitle_tracks`, `playback_failure_reports`                                                                                                                                                                                                                          |
| `reviews`        | `ratings`, `reviews`, `review_reactions`, `review_reports`                                                                                                                                                                                                               |
| `moderation`     | `content_reports`, `moderation_actions`                                                                                                                                                                                                                                  |
| `notifications`  | `notification_preferences`, `notifications`, `push_subscriptions`, `notification_deliveries`, `announcements`, `admin_notifications`                                                                                                                                     |
| `analytics`      | `guest_sessions`, `content_view_events`, `playback_analytics_events`, `analytics_daily_aggregates`, `search_events` (if required)                                                                                                                                        |
| `administration` | `admin_accounts`, `admin_login_attempts`, `admin_session_events`, `system_settings`, `system_setting_versions`, `admin_dashboard_layouts`, `admin_audit_log`                                                                                                             |
| `maintenance`    | `maintenance_task_runs`, `backup_manifests`, `system_alerts`, `incidents`, `incident_notes`, `incident_attachments`, `error_records`, `health_snapshots`                                                                                                                 |

Table names may be refined in Prompt 020, but ownership may not move without an architecture decision.

---

## 4. Planned Schema Groups

Prompt 020 requires modular schemas separated by domain:

1. **Authentication** — Better Auth tables, account status, Google identity linkage, session metadata.
2. **Authorization** — roles, permissions, role-permission mappings, user-role assignments.
3. **Content** — dramas, seasons, episodes, movies, taxonomies, relationships, slug history, SEO, assets, Trash.
4. **User features** — bookmarks, playback progress, watch history, watched state.
5. **Reviews and moderation** — ratings, reviews, reactions, review reports, content reports, moderation actions.
6. **Analytics** — guest sessions, view events, playback events, aggregates.
7. **Notifications** — preferences, in-app notifications, push subscriptions, deliveries, announcements, admin notifications.
8. **Administration** — admin accounts, login attempts, session events, settings and versions, dashboard layouts, audit.
9. **Maintenance** — task runs, backup manifests, alerts, incidents, notes, attachments, error records, health snapshots.

Do not merge unrelated entities into one table. Do not create a single polymorphic "content" table that erases the distinction between dramas, seasons, episodes, and movies.

---

## 5. Relationship Integrity

- Prefer real foreign keys over application-only references.
- Cross-module foreign keys are allowed at the database level but do not grant write permission.
- For relationships spanning dramas and movies (ratings, reviews, bookmarks, view events), use one of:
  - typed FK columns plus a check constraint that exactly one target is set, or
  - separate typed relationship tables.
    **Chosen in Prompt 020:** typed FK columns plus a check constraint. Each relationship table has nullable `drama_id` and `movie_id` foreign keys and a `CHECK` constraint enforcing that exactly one is non-NULL. Uniqueness uses partial unique indexes for the active drama and movie cases. A generic polymorphic `content_type` + `content_id` pair is forbidden unless real referential integrity is enforced by another documented mechanism.
- Deleting a season moves the season and its episodes to Trash together; permanent deletion cleanup is explicit and transactional.
- Do not rely on `ON DELETE CASCADE` across module ownership boundaries. Destructive cleanup is performed by the owning module inside `workflows/permanently-delete-content`.
- The hierarchy is enforced by the database as of migration `0009`: `seasons.drama_id` and `episodes.drama_id` reference `dramas.id` with `ON DELETE RESTRICT`, and the composite foreign key `episodes(drama_id, season_id) → seasons(drama_id, id)` makes an episode whose season belongs to another drama impossible. The workflows still check the parent themselves; the constraint is the backstop. See `DATA_INTEGRITY.md`.
- Stable IDs survive edits, reordering, moving, conversion, and source replacement.
- Soft-deleted rows are excluded from normal queries and do not block reuse of slugs or names (partial unique indexes).

---

## 6. Index and Search Strategy

- Index every foreign key.
- Index list-query filters and deterministic sort columns (for example `dramas(status, published_at desc, id)`).
- Use partial indexes for active rows: `WHERE deleted_at IS NULL`.
- Use unique indexes on `lower(name)` where names are case-insensitively unique.
- Full-text search: `tsvector` columns with GIN indexes for titles, descriptions, categories, and platforms.
- Trigram search: `pg_trgm` with GIN indexes for autocomplete and fuzzy matching.
- Do not add indexes speculatively. Each index is tied to a documented query in `DATABASE.md`.
- Review `pg_stat_statements` and slow-query data in production before adding indexes.

The exact search schema is implemented with the search feature and documented here.

### 6.1 `idx_users_active_created_at` (Prompt 051)

One index was added for the admin user listing (`/admin/users`), the only new
production list query in that prompt. It is defined in
`src/modules/auth/schema.ts` and applied by
`drizzle/0003_needy_infant_terrible.sql`:

```sql
CREATE INDEX "idx_users_active_created_at" ON "users" USING btree ("created_at" DESC NULLS LAST) WHERE "users"."deleted_at" is null;
```

| Serves                                                                                                                                | Does not serve                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The default scope `deleted_at IS NULL` (the index predicate), used when `status` is absent, `active`, or `deactivated`.               | The `deleted` filter: its predicate is `deleted_at IS NOT NULL`, the complement of the index predicate. No btree index on `created_at` can support it, so the filter is a sequential scan over the deleted subset. |
| The default sort `created_at DESC`.                                                                                                   | The free-text search: `ILIKE` against `name` and `email` with escaped wildcards. It remains a sequential scan until query-plan evidence justifies a trigram index.                                                 |
| The default listing's access path (`deleted_at IS NULL` → `created_at DESC`); a sort step remains for tied rows (limitation 2 below). | The residual `active` / `deactivated` / `superAdmin` predicates, which are evaluated after the index scan rather than by the index.                                                                                |

Two known limitations are recorded rather than hidden:

1. The `CREATE INDEX` is **not** `CONCURRENTLY`, so applying the migration takes
   a brief write lock on `users` while it builds. The table is small today; a
   deployment that cannot tolerate the lock needs a reviewed `CONCURRENTLY`
   follow-up migration.
2. The index covers `created_at DESC` only, while the query's sort is
   `ORDER BY created_at DESC, id ASC` (`id` is the deterministic tiebreaker —
   `CONVENTIONS.md` §6.3). A sort step therefore remains for rows with tied
   `created_at` values.

#### Measured plans

`EXPLAIN (ANALYZE, BUFFERS)` was run against the migrated `dramascan_test`
database with a small set of explain-test rows (2 active, 1 deactivated, 2
deleted), which were removed afterwards. On a table that small PostgreSQL chose
a sequential scan for every case, so the plans record the access path and its
estimated cost, **not** evidence that the index is used at today's data volume.

| Query (filter, sort, page)                                                    | Chosen path     | Partial index used? | Execution time |
| ----------------------------------------------------------------------------- | --------------- | ------------------- | -------------- |
| `deleted_at IS NULL`, `ORDER BY created_at DESC, id ASC`, `LIMIT 20 OFFSET 0` | Seq Scan + sort | No                  | 0.210 ms       |
| `deleted_at IS NULL AND is_active`, same sort and page                        | Seq Scan + sort | No                  | 0.056 ms       |
| `deleted_at IS NULL AND NOT is_active`, same sort and page                    | Seq Scan + sort | No                  | 0.067 ms       |
| `deleted_at IS NOT NULL`, same sort and page                                  | Seq Scan + sort | No                  | 0.054 ms       |

Verbatim plan for the default listing (the case the index exists for):

```
Limit  (cost=1.01..1.01 rows=1 width=106) (actual time=0.151..0.155 rows=3.00 loops=1)
  Buffers: shared hit=7
  ->  Sort  (cost=1.01..1.01 rows=1 width=106) (actual time=0.148..0.151 rows=3.00 loops=1)
        Sort Key: created_at DESC, id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=7
        ->  Seq Scan on users  (cost=0.00..1.00 rows=1 width=106) (actual time=0.049..0.052 rows=3.00 loops=1)
              Filter: (deleted_at IS NULL)
              Rows Removed by Filter: 2
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=72
Planning Time: 4.352 ms
Execution Time: 0.210 ms
```

The other three plans have the same shape: `Limit` → `Sort` (`created_at DESC,
id`) → `Seq Scan on users` with the filter as shown in the table above. The
`deleted` case's filter is `(deleted_at IS NOT NULL)` with 3 rows removed; the
`active` case's is `((deleted_at IS NULL) AND is_active)` with 3 removed; the
`deactivated` case's is `((deleted_at IS NULL) AND (NOT is_active))` with 4
removed.

**Read this honestly:** the index is present and correct, and the plans were
measured on a table far too small for the planner to prefer it. No plan here
demonstrates that the index is chosen; the index is the documented supporting
index for the demonstrated access path, as `CONVENTIONS.md` §5.4 requires, and
production `pg_stat_statements` review is the trigger for any further index.

### 6.2 Search indexes (Prompts 121–138)

Migration `drizzle/0016_search_indexes.sql` installs the `pg_trgm` extension
and adds the indexes the public search uses. Each index is tied to a
documented query:

| Index                                          | Table        | Serves                                                       |
| ---------------------------------------------- | ------------ | ------------------------------------------------------------ |
| `idx_dramas_title_trgm` (GIN, `gin_trgm_ops`)  | `dramas`     | Trigram title match and the autocomplete suggestions        |
| `idx_movies_title_trgm` (GIN, `gin_trgm_ops`)  | `movies`     | Trigram title match and the autocomplete suggestions        |
| `idx_categories_name_trgm` (GIN, `gin_trgm_ops`) | `categories` | Trigram name match in the search results and the suggestions |
| `idx_platforms_name_trgm` (GIN, `gin_trgm_ops`) | `platforms`  | Trigram name match in the search results and the suggestions |
| `idx_dramas_title_fts` (GIN, `to_tsvector`)    | `dramas`     | Full-text title match and the relevance order                |
| `idx_movies_title_fts` (GIN, `to_tsvector`)    | `movies`     | Full-text title match and the relevance order                |

The full-text indexes are on `to_tsvector('simple', title)` rather than on the
default configuration, because the queries use the `simple` configuration; an
index built on the default configuration would not match the query and
PostgreSQL would fall back to a sequential scan.

The relevance order is a ladder (D-051): an exact title match, a prefix, a
contains, a full-text match, and finally the scaled trigram score. The
trigram index is deliberately generous, so it is the *last* step of the ladder
rather than the only one — otherwise the title the viewer typed is not the
first result.

---

## 7. Migrations

Migration tooling and practices are defined in `CONVENTIONS.md` §10. Database-specific rules:

- Migrations live in `drizzle/` and are numbered sequentially.
- The applied baseline is `drizzle/0000_boring_harry_osborn.sql` (50 statements, 42 tables), generated from the complete schema with `drizzle-kit generate` and applied with `drizzle-kit migrate`. Its snapshot is `drizzle/meta/0000_snapshot.json` and its journal entry is `drizzle/meta/_journal.json`.
- `drizzle/0001_pale_earthquake.sql` adds login monitoring (`login_attempts`) and session activity.
- `drizzle/0002_information_page_footer_links.sql` adds `information_pages.position`, the active-row slug uniqueness index, the partial footer index, and the six-row information-page seed (forward-only; the seed is idempotent and preserves administrator edits).
- `drizzle/0003_needy_infant_terrible.sql` adds one partial index, `idx_users_active_created_at`, for the admin user listing (Prompt 051). Reversible: `DROP INDEX idx_users_active_created_at;` — the index is the migration's only statement, so the rollback restores `0002` exactly (the `CREATE INDEX` is not `CONCURRENTLY`, so neither is this drop). See §6.1 for the queries it serves, the queries it does not serve, and the measured plans.
- `drizzle/0005_yielding_mimic.sql` adds `structure_conversion_snapshots`, the drama structure-conversion snapshot table (Prompt 066). Reversible: `DROP TABLE structure_conversion_snapshots;` — the table has no dependents, so the rollback restores `0004` exactly. The migration is forward-only in practice: dropping the table discards the snapshots, and a drama that was converted season-based → flat cannot be restored to its previous season structure afterwards.
- `drizzle/0006_cute_kabuki.sql` makes `ratings.drama_id` and `reviews.drama_id` nullable, adds their `movie_id` columns and exactly-one CHECK constraints, adds `movies.converted_from_drama_id` with its FK and partial unique index, and replaces the per-target unique/lookup indexes (Prompt 067). Reversible with the inverse statements after moving every row back to a drama target; no column or row is dropped.
- `drizzle/0009_content_integrity_and_typed_targets.sql` adds the content hierarchy foreign keys (including the composite `episodes(drama_id, season_id)` → `seasons(drama_id, id)` target), taxonomy and similar-drama foreign keys, scoped unique indexes, `review_reports` lifecycle columns, typed `drama_id`/`movie_id` targets on the four user-content tables, and nullable `published_at` on the four publishable content tables. Foreign keys and CHECK constraints are added `NOT VALID` and unique indexes are created in guarded blocks, so the migration cannot abort on legacy data. Forward-fix-only; the operator procedure is `docs/development/DATA_INTEGRITY.md` and the command is `npm run db:integrity`.
- `drizzle/0010_typed_analytics_targets_and_report_state.sql` extends `0009` with typed `drama_id`/`movie_id` targets on the three analytics tables (`content_view_events`, `playback_analytics_events`, `analytics_daily_aggregates`), the full `review_reports` state (`description`, `resolved_by`, `resolution_outcome`, `reported_at`, and the lifecycle CHECK), and replaces the report → review foreign key with an `ON DELETE RESTRICT` one so moderation history survives the removal of a review. `reported_at` is added as a nullable column and only afterwards given `DEFAULT now()`, so legacy reports keep an empty submission time instead of a fabricated one. All foreign keys and CHECK constraints are added `NOT VALID`; forward-fix-only; the operator procedure is `docs/development/DATA_INTEGRITY.md` and the command is `npm run db:integrity`.
- `drizzle/0011_anonymized_ratings_and_reviews.sql` allows a rating or review to outlive its content (Prompt 073). It makes `ratings.user_id` and `reviews.user_id` nullable, adds the nullable `anonymized_at` timestamp to both tables, and replaces `ck_ratings_target` / `ck_reviews_target` with a version that accepts a third state: both target columns are `NULL` **and** `anonymized_at IS NOT NULL`. An ordinary row must still point at exactly one drama or movie, so the exactly-one rule of D-020 is preserved for every row that has not been anonymized. Forward-fix-only: rolling back would drop the `anonymized_at` column and its data, so the anonymized rows have to be re-derived or discarded first. No row is rewritten by the migration itself.
- `drizzle/0012_anonymized_rows_have_no_author.sql` enforces the author half of the anonymization rule (Prompt 073). It adds `ck_ratings_anonymized_author` and `ck_reviews_anonymized_author`, each of which requires `anonymized_at IS NULL OR user_id IS NULL`. Migration `0011` made the author nullable and the target removable; this migration closes the gap where an anonymized row could still name its author. The constraints are additive: an existing row satisfies them, because a row with `anonymized_at IS NULL` is accepted by either branch. Reversible: `ALTER TABLE ratings DROP CONSTRAINT ck_ratings_anonymized_author; ALTER TABLE reviews DROP CONSTRAINT ck_reviews_anonymized_author;` — no row is dropped or rewritten, so the rollback restores `0011` exactly. No row is rewritten by the migration itself.
- `drizzle/0013_video_source_workflow.sql` adds `subtitle_tracks`, `playback_failure_reports`, and `admin_audit_log` for the direct video source workflow (Prompts 080–090). The three cross-module foreign keys are added `NOT VALID`.
- `drizzle/0014_video_source_version.sql` adds `episodes.video_source_version` and changes the two playback foreign keys to the episode from `ON DELETE CASCADE` to `ON DELETE RESTRICT` (Prompts 080–090 review fixes). See §8.8.
- `drizzle/0015_moderation_and_settings.sql` adds the moderation audit log and the system settings table, and changes the report → review foreign key (Prompts 115–120). It creates `moderation_actions` and `system_settings`; it adds the immutable `review_id_snapshot` to `review_reports`, backfills it from the existing `review_id`, makes `review_id` nullable, and replaces the `ON DELETE RESTRICT` foreign key with an `ON DELETE SET NULL` one, so a permanently removed review no longer deletes the moderation history that refers to it. The CHECK `ck_review_reports_review_reference` requires a report to name either a live review or its snapshot, so the history can never lose its subject. The cross-module foreign keys (`moderation_actions.actor_user_id`, `system_settings.updated_by`) are added `NOT VALID` and use `ON DELETE SET NULL`: an audit row outlives the administrator who wrote it. Forward-fix-only: rolling back would drop the audit log and the settings.
- `drizzle/0016_search_indexes.sql` installs the `pg_trgm` extension and adds the GIN indexes that the search and the relevance order use (Prompts 121–138). It adds a `gin_trgm_ops` index on `dramas.title`, `movies.title`, `categories.name`, and `platforms.name`, and a `to_tsvector('simple', …)` GIN index on the two title columns. The extension is installed inside a guarded block, so the migration is safe to re-run against a database that already has it. Reversible: the indexes and the extension can be dropped without touching any row.
- `drizzle/0017_audit_log_nullable_entity.sql` makes `admin_audit_log.entity_id` nullable (Prompts 121–138 audit fix, D-056). A global homepage setting — the featured item, the hero rotation, the Trending pins — is not a content row and has no identifier, so an action on one is recorded with `entity_type = 'homepage_setting'` and no entity id. Before this migration the column was `NOT NULL`, and the workflow wrote the literal strings `featured`, `hero_rotation`, and `trending_pins` into it; PostgreSQL rejected the insert, the transaction rolled back, and every save of those settings failed. The column stays a uuid, the indexes are unchanged, and no row is rewritten. Reversible: `ALTER TABLE "admin_audit_log" ALTER COLUMN "entity_id" SET NOT NULL` restores the old constraint once no setting event exists.
- `drizzle/0018_analytics_and_notifications.sql` completes the analytics and notification data model (Prompts 139–154). It adds the `deleted_at` column to `content_view_events`, `playback_analytics_events`, and `search_events`, the `episode_id` column to `playback_analytics_events`, the three guest-session foreign keys and the episode foreign key (`ON DELETE restrict`), the deduplication indexes that make the six-hour view window and the bounded playback writes enforceable, the notification indexes, and the independent `notification_preferences.new_drama` switch. See §8.9.
- `drizzle/0019_analytics_retention_indexes.sql` adds the three indexes the analytics retention command needs: `idx_guest_sessions_created_at` (the expired anonymous sessions), `idx_search_events_searched_at` (the expired search events), and `idx_playback_analytics_events_guest_session` (the "does an event still point at this session?" check). Without them the command would read a whole table on every run.
- The content Trash (Prompts 072–074) needs no migration: it reuses the existing `deleted_at` columns on `dramas`, `seasons`, `episodes`, and `movies`, and the existing `deleted_at` indexes. The cascade timestamp is a value in those columns, not a new column.
- Image assets (Prompts 075–078) need no migration: the stored artwork lives on the application disk, and the content tables keep only the managed `/media/...` path in `dramas.poster`, `dramas.banner`, `movies.poster`, and `movies.banner`.
- `npm run db:generate` creates the next numbered migration from schema changes; `npm run db:migrate` applies pending migrations. `npm run db:push` is local-only and must never be used against production.
- Integration tests build the isolated `_test` database from this same migration chain in `tests/global-setup.ts`, so a broken migration fails CI.
- Applied migrations are never edited.
- Use expand-contract for breaking changes.
- Every migration documents whether it is reversible or forward-fix-only.
- Destructive migrations require a backup and explicit confirmation.
- The application role has DML rights; a separate migration role has DDL rights.
- Production never uses `drizzle-kit push` or automatic schema synchronization.
- Seed only reference data with idempotent seeds.

---

## 8. Table Catalog

This catalog is filled in as tables are implemented. Each entry records the table, owning module, purpose, key relationships, indexes, and status.

| Table                          | Module                                                   | Purpose                                                                  | Status         |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------ | -------------- |
| dramas                         | content                                                  | Dramas ( TV/streaming series )                                           | ✅ Implemented |
| seasons                        | content                                                  | Seasons per drama                                                        | ✅ Implemented |
| episodes                       | content                                                  | Episodes per season                                                      | ✅ Implemented |
| movies                         | content Standalone films                                 | ✅ Implemented                                                           |
| categories                     | content Content taxonomies                               | ✅ Implemented                                                           |
| platforms                      | content Streaming platforms                              | ✅ Implemented                                                           |
| drama_categories               | content Drama–category many-to-many                      | ✅ Implemented                                                           |
| drama_platforms                | content Drama–platform many-to-many                      | ✅ Implemented                                                           |
| movie_categories               | content Movie–category many-to-many                      | ✅ Implemented                                                           |
| movie_platforms                | content Movie–platform many-to-many                      | ✅ Implemented                                                           |
| similar_dramas                 | content Similarity recommendations                       | ✅ Implemented                                                           |
| information_pages              | content Legal/information pages and footer configuration | ✅ Implemented                                                           |
| structure_conversion_snapshots | content                                                  | Pre-conversion season structure snapshots for drama structure conversion | ✅ Implemented |
| content_slug_history           | content Slug change history                              | ✅ Implemented                                                           |
| content_seo                    | content SEO metadata per content                         | ✅ Implemented                                                           |
| content_assets                 | content Media/assets per content                         | ✅ Implemented                                                           |
| sitemap_exclusions             | content Sitemap URL exclusions                           | ✅ Implemented                                                           |
| users_bookmarks                | users User bookmarks                                     | ✅ Implemented                                                           |
| users_watch_history            | users Watch history                                      | ✅ Implemented                                                           |
| users_watched_state            | users Per-episode watched state                          | ✅ Implemented                                                           |
| playback_progress              | users Playback position per user and episode (target owner: `playback` — see D-040) | ✅ Implemented                                                           |
| watched_state                  | users Per-episode watched/unwatched state (target owner: `playback` — see D-040) | ✅ Implemented                                                           |
| watch_history                  | users Append-only watch history (target owner: `playback` — see D-040) | ✅ Implemented                                                           |
| subtitle_tracks                | playback Per-episode subtitle tracks: language, label, format, default selection, direct source URL | ✅ Implemented                                                           |
| playback_failure_reports       | playback Viewer-reported failures of an external source  | ✅ Implemented                                                           |
| admin_audit_log                | administration Operational record of administrative actions | ✅ Implemented                                                           |
| ratings                        | reviews User ratings (1–5)                               | ✅ Implemented                                                           |
| reviews                        | reviews User reviews                                     | ✅ Implemented                                                           |
| review_reactions               | reviews Review reactions (likes)                         | ✅ Implemented                                                           |
| review_reports                 | reviews Review reports                                   | ✅ Implemented                                                           |
| content_reports                | moderation User content reports                          | ✅ Implemented                                                           |
| moderation_actions             | moderation Admin moderation actions                      | ✅ Implemented                                                           |
| notification_preferences       | notifications                                            | User notification preferences                                            | ✅ Implemented |
| notifications                  | notifications In-app notifications                       | ✅ Implemented                                                           |
| push_subscriptions             | notifications Push subscription endpoints                | ✅ Implemented                                                           |
| notification_deliveries        | notifications Delivery tracking records                  | ✅ Implemented                                                           |
| announcements                  | notifications Site-wide announcements                    | ✅ Implemented                                                           |
| admin_notifications            | notifications Admin-targeted notifications               | ✅ Implemented                                                           |
| users                          | auth Auth users (Better Auth)                            | ✅ Implemented                                                           |
| accounts                       | auth OAuth/account linking                               | ✅ Implemented                                                           |
| sessions                       | auth Auth sessions                                       | ✅ Implemented                                                           |
| verifications                  | auth Email/email OTP verifications                       | ✅ Implemented                                                           |
| roles                          | authorization                                            | Role definitions (built-in and custom)                                   | ✅ Implemented |
| permissions                    | authorization                                            | Per-role `(resource, action)` grants and revocations                     | ✅ Implemented |
| user_roles                     | authorization                                            | User ↔ role assignments (many-to-many)                                   | ✅ Implemented |
| guest_sessions                 | analytics Anonymous guest sessions                       | ✅ Implemented                                                           |
| content_view_events            | analytics Content view events                            | ✅ Implemented                                                           |
| playback_analytics_events      | analytics Playback analytics events                      | ✅ Implemented                                                           |
| analytics_daily_aggregates     | analytics Daily aggregate metrics                        | ✅ Implemented                                                           |
| search_events                  | analytics Search event logs                              | ✅ Implemented                                                           |
| admin_accounts                 | administration Admin user accounts                       | ⏳ Pending migration                                                     |
| admin_login_attempts           | administration Admin login attempts                      | ⏳ Pending migration                                                     |
| admin_session_events           | administration Admin session events                      | ⏳ Pending migration                                                     |
| system_settings                | administration System configuration                      | ✅ Implemented (`drizzle/0015_moderation_and_settings.sql`)              |
| system_setting_versions        | administration System setting versions                   | ⏳ Pending migration                                                     |
| admin_dashboard_layouts        | administration Admin dashboard layouts                   | ⏳ Pending migration                                                     |
| maintenance_task_runs          | maintenance Scheduled maintenance runs                   | ⏳ Pending migration                                                     |
| backup_manifests               | maintenance Backup file manifests                        | ⏳ Pending migration                                                     |
| system_alerts                  | maintenance System alerts                                | ⏳ Pending migration                                                     |
| incidents                      | maintenance Incident reports                             | ⏳ Pending migration                                                     |
| incident_notes                 | maintenance Incident notes                               | ⏳ Pending migration                                                     |
| incident_attachments           | maintenance Incident attachments                         | ⏳ Pending migration                                                     |
| error_records                  | maintenance Error record log                             | ⏳ Pending migration                                                     |
| health_snapshots               | maintenance Health check snapshots                       | ⏳ Pending migration                                                     |

### 8.1 Authorization (RBAC) canonical model

The canonical permission identifier is `resource.action`. `src/modules/authorization/permissions.ts` is the single source of truth; the database stores the pair split across `permissions.resource` and `permissions.action`.

Constraints and indexes (generated DDL verified with `drizzle-kit generate`):

- `permissions` unique `uq_permissions_role_id_resource_action` on `(role_id, resource, action)` — one grant/revocation row per role and canonical key.
- `permissions` check `ck_permissions_permission_key` enforces the exact composed `resource || '.' || action` against the full canonical key list, generated from `ALL_PERMISSION_KEYS`. Invalid pairs and non-catalog combinations cannot be stored, even by out-of-band SQL. Changing the catalog requires regenerating this check in the same migration.
- `permissions.role_id` FK `fk_permissions_role_id` → `roles.id` (NO ACTION).
- `user_roles` uses the composite primary key `pk_user_roles (user_id, role_id)`, which is also the duplicate-assignment guard, plus FK `fk_user_roles_role_id` → `roles.id` and index `idx_user_roles_role_id`. The primary key covers the leading `user_id` lookup; the index covers "users in a role". Content join tables (`drama_categories`, `drama_platforms`, `movie_categories`, `movie_platforms`, `similar_dramas`) follow the same composite-primary-key pattern.
- `roles` unique `uq_roles_name`.
- `user_roles.user_id` is a cross-module reference to `users.id`; the generated baseline creates `fk_user_roles_user_id` with `ON DELETE CASCADE` because the auth user row is the owner of the assignment.
- `granted = false` is an explicit revocation; rows are not deleted. Effective permissions exclude revoked rows. Unknown/stale rows are ignored by the actor resolver (deny by default).

#### Migration and reconciliation strategy

The reconciled tables are part of the initial baseline migration `drizzle/0000_boring_harry_osborn.sql`, generated from the complete schema and applied with `drizzle-kit migrate`. The applied migration is recorded in `drizzle.__drizzle_migrations`. Production must apply migrations, never `drizzle-kit push`.

For a database created outside migrations, run the checks below before applying the constraints and reconcile manually with a backup. Do not discard data automatically.

```sql
-- 1. Pairs outside the canonical catalog (must return no rows).
SELECT DISTINCT resource, action FROM permissions
WHERE (resource || '.' || action) NOT IN ('drama.create', 'drama.read', 'drama.update', 'drama.delete', 'drama.manage', 'movie.create', 'movie.read', 'movie.update', 'movie.delete', 'movie.manage', 'episode.create', 'episode.read', 'episode.update', 'episode.delete', 'episode.manage', 'category.create', 'category.read', 'category.update', 'category.delete', 'category.manage', 'platform.create', 'platform.read', 'platform.update', 'platform.delete', 'platform.manage', 'user.read', 'user.manage', 'review.create', 'review.read', 'review.delete', 'review.manage', 'rating.read', 'rating.manage', 'analytics.read', 'analytics.manage', 'settings.read', 'settings.manage', 'admin.manage');

-- 2. Duplicate grants per role and pair (must return no rows).
SELECT role_id, resource, action, count(*) AS duplicates
FROM permissions GROUP BY 1, 2, 3 HAVING count(*) > 1;

-- 3. Duplicate role assignments (must return no rows).
SELECT user_id, role_id, count(*) AS duplicates
FROM user_roles GROUP BY 1, 2 HAVING count(*) > 1;

-- 4. Duplicate role names (must return no rows).
SELECT name, count(*) AS duplicates FROM roles GROUP BY 1 HAVING count(*) > 1;

-- 5. Orphaned rows (must return no rows).
SELECT p.id FROM permissions p LEFT JOIN roles r ON r.id = p.role_id WHERE r.id IS NULL;
SELECT ur.user_id, ur.role_id FROM user_roles ur LEFT JOIN roles r ON r.id = ur.role_id WHERE r.id IS NULL;
```

For duplicate grants, keep the row with `granted = true` where any exists (revoked duplicates are redundant); review the affected rows and delete extras inside a transaction. For `user_roles`, keep the earliest `assigned_at`. Create missing roles instead of deleting assignments; never drop a role assignment silently.

When a table is added, record:

- owning module,
- purpose,
- primary key and key columns,
- foreign keys and referential actions,
- unique/check constraints,
- indexes and the query each supports,
- soft-delete behavior,
- migration file,
- related API/query functions.

When a table is added, record:

- owning module,
- purpose,
- primary key and key columns,
- foreign keys and referential actions,
- unique/check constraints,
- indexes and the query each supports,
- soft-delete behavior,
- migration file,
- related API/query functions.

### 8.2 Information pages and footer links (Prompt 045)

`information_pages` is owned by the `content` module and is the single source
for the public footer's legal/information links and the `/information/[slug]`
pages.

| Item                     | Detail                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                  | Administrator-managed legal and information pages (Terms, Privacy, Community Guidelines, Copyright/DMCA, About, Contact).                                                                 |
| Primary key              | `id uuid` (`uuidv7()` default).                                                                                                                                                           |
| Key columns              | `title`, `slug`, `content`, `publication_status` (`draft`/`published`/`unpublished`), `preview`, `footer_visible`, `position`.                                                            |
| Timestamps / soft delete | `created_at`, `updated_at`, `deleted_at` (`timestamptz`). Trash is `deleted_at IS NOT NULL`.                                                                                              |
| Constraints              | `uq_information_pages_slug_active` — partial unique index on `slug WHERE deleted_at IS NULL`, so a slug may be reused after soft delete.                                                  |
| Indexes                  | `idx_information_pages_footer` — partial index on `position WHERE deleted_at IS NULL AND publication_status = 'published' AND footer_visible = true`, supporting the public footer query. |
| Ordering                 | `position` ascending; null positions sort last, then title and id for determinism. Reordering is transactional.                                                                           |
| Migration                | `drizzle/0002_information_page_footer_links.sql` (schema + idempotent six-row seed).                                                                                                      |
| Query/service API        | `src/modules/content/information-pages.ts` (`listFooterInformationLinks`, `getPublishedInformationPage`, `listInformationPages`, `updateInformationPage`, `reorderInformationPages`).     |
| Admin API                | `GET /admin/api/information-pages`, `PATCH /admin/api/information-pages/[id]`, `PUT /admin/api/information-pages/reorder`; requires `settings.manage`.                                    |
| Public visibility        | Published, footer-visible, non-deleted rows with a valid single-segment slug only. Drafts are never rendered publicly.                                                                    |

The seed inserts exactly six published, footer-visible rows with body
`This page is being prepared.` and positions 1–6. It uses
`ON CONFLICT ("slug") WHERE "deleted_at" IS NULL DO NOTHING`, so re-running the
statement is harmless and administrator-edited content is never overwritten.

### 8.3 Standalone movies (Prompt 065)

`movies` is an independent content type owned by the `content` module. A movie
has no drama, season, or episode parent; it is never modelled as a hidden season
or episode. Its single direct video source lives on the same row.

| Item                     | Detail                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                  | Standalone feature films with their own metadata, taxonomies, publication state, and direct playback source.                                                                                              |
| Primary key              | `id uuid` (`uuidv7()` default).                                                                                                                                                                           |
| Key columns              | `title`, `slug`, `description`, `poster`, `banner`, `publication_status` (`draft`/`published`/`unpublished`), `video_source`.                                                                             |
| Timestamps / soft delete | `created_at`, `updated_at`, `deleted_at` (`timestamptz`). Trash is `deleted_at IS NOT NULL`.                                                                                                              |
| Constraints              | `uq_movies_slug_active` — partial unique index on `slug WHERE deleted_at IS NULL`, so a slug may be reused after soft delete.                                                                             |
| Associations             | `movie_categories (movie_id, category_id)` and `movie_platforms (movie_id, platform_id)`, both composite-PK join tables. Associations are replaced wholesale in the same transaction as the movie update. |
| Video source             | Administrator-supplied absolute HTTPS URL. Only syntax and the HTTPS scheme are validated; the server never fetches, proxies, transcodes, or rehosts the media. The browser plays the URL directly.       |
| Migration                | `drizzle/0004_redundant_carmella_unuscione.sql` (adds `video_source` and the active-slug index; also adds `dramas.structure_type` and `season.manage`).                                                   |
| Workflow API             | `src/workflows/admin/movies.ts` (`createMovie`, `updateMovie`); requires `movie.manage`. Slug changes append `content_slug_history` rows with `content_type = 'movie'`.                                   |
| Admin API                | `POST /admin/api/movies`, `PUT /admin/api/movies`; requires `movie.manage` and same-origin mutations.                                                                                                     |
| Validation               | `src/modules/content/validation.ts` (`createMovieSchema`, `updateMovieSchema`, `movieVideoSourceSchema`, `moviePublicationStatusSchema`). Updates are full-payload replaces.                              |

Prompt 067 adds the nullable provenance column `converted_from_drama_id`; see §8.5.

### 8.4 Drama structure conversion snapshots (Prompt 066)

`structure_conversion_snapshots` is owned by the `content` module. It records the
season structure of a drama before a season-based → flat conversion so the
conversion can be reversed. Snapshots are history: they are superseded or
marked restored, never deleted.

| Item                     | Detail                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                  | Exact pre-conversion season/episode structure for one drama, plus the fingerprint of the structure that resulted from the conversion.                                                                                                                                  |
| Primary key              | `id uuid` (`uuidv7()` default).                                                                                                                                                                                                                                        |
| Key columns              | `drama_id`, `source_structure_type` (`season_based`), `target_structure_type` (`flat`), `season_data` (`jsonb`), `episode_data` (`jsonb`), `post_conversion_fingerprint` (text), `status` (`available` \| `restored` \| `superseded`), `restored_at`, `superseded_at`. |
| Timestamps / soft delete | `created_at`, `updated_at` (`timestamptz`). Snapshots are not soft-deleted; the `status` column carries the lifecycle.                                                                                                                                                 |
| Constraints              | `ck_structure_conversion_snapshots_status` — status is one of `available`, `restored`, `superseded`. `ck_structure_conversion_snapshots_direction` — the snapshot direction is always season-based → flat.                                                             |
| Relationships            | `fk_structure_conversion_snapshots_drama_id` → `dramas.id` `ON DELETE CASCADE` (the first deliberate foreign key in the content hierarchy). `idx_structure_conversion_snapshots_drama_id` supports the per-drama lookup.                                               |
| Uniqueness               | `uq_structure_conversion_snapshots_drama_id_available` — partial unique index on `drama_id WHERE status = 'available'`, so at most one restorable snapshot exists per drama. Superseding and restoring are part of the conversion transaction.                         |
| Migration                | `drizzle/0005_yielding_mimic.sql`.                                                                                                                                                                                                                                     |
| Workflow API             | `src/workflows/admin/conversion.ts` (`previewConversion`, `applyConversion`); requires `drama.manage`. The apply runs in a serializable transaction with the drama row locked `FOR UPDATE`.                                                                            |
| Admin API                | `POST /admin/api/dramas/convert`; requires `drama.manage` and same-origin mutations.                                                                                                                                                                                   |
| Validation               | `src/modules/content/validation.ts` (`conversionRequestSchema`, `conversionDistributionSchema`, snapshot payload schemas) and `src/modules/content/conversion.ts` (ordering, plans, fingerprint, snapshot payload build/parse).                                        |

Restoring a snapshot re-applies the stored season rows, episode season
assignment, episode numbers, and positions only. Episode titles,
descriptions, publication status, and video sources are never restored from a
snapshot, and viewing records are never touched. A snapshot is restorable only
while the current flat structure still matches `post_conversion_fingerprint`.

### 8.5 Drama→movie conversion (Prompt 067)

A drama with exactly one active episode can be converted into a standalone
movie. The conversion creates a new `movies` row with a new UUID, copies the
content identity and the single episode's video source, moves the content
relationships, and soft-deletes the source drama, its seasons, and its
episodes in the same transaction. The drama UUID is never reused.

| Item                  | Detail                                                                                                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provenance column     | `movies.converted_from_drama_id uuid NULL`.                                                                                                                                                                                                                                                                |
| Provenance FK         | `fk_movies_converted_from_drama_id` → `dramas.id` `ON DELETE RESTRICT`, so a movie blocks permanent deletion of its source drama.                                                                                                                                                                          |
| Provenance uniqueness | `uq_movies_converted_from_drama_id` — partial unique index where the column is not null; one drama converts at most once.                                                                                                                                                                                  |
| Eligibility           | Exactly one active episode (`episodes.deleted_at IS NULL`). Zero or more than one is a `409`; trashed episodes and seasons are excluded and left untouched. An already converted drama is permanently ineligible.                                                                                          |
| Slug                  | Copied verbatim. `uq_movies_slug_active` rejects a collision with another active movie (`409`); the slug is never auto-suffixed.                                                                                                                                                                           |
| Publication state     | `draft`, `published`, and `unpublished` carry over; any other stored value becomes `draft` with a preview warning.                                                                                                                                                                                         |
| Source lifecycle      | `dramas`, `seasons`, and `episodes` are soft-deleted (`deleted_at`/`updated_at` set). No hard delete occurs; the source remains for audit and future Trash lifecycle work.                                                                                                                                 |
| User state            | `bookmarks`, `playback_progress`, `watched_state`, and `watch_history` move to the movie. Progress and watched-state `episode_id` become `NULL`; `watch_history.episode_id` is preserved as historical fact.                                                                                               |
| Metadata              | `content_slug_history`, `content_seo`, `content_assets`, notifications, admin notifications, content view events, playback analytics events, and daily aggregates move to the movie. `similar_dramas` and `structure_conversion_snapshots` are untouched.                                                  |
| Null types            | Only rows with `content_type = 'drama'` are rewritten in polymorphic tables; rows with a `NULL` type are not guessed.                                                                                                                                                                                      |
| Migration             | `drizzle/0006_cute_kabuki.sql`.                                                                                                                                                                                                                                                                            |
| Workflow API          | `src/workflows/admin/movie-conversion.ts` (`loadMovieConversionContext`, `previewMovieConversion`, `applyMovieConversion`); requires `drama.manage`. Apply uses a serializable transaction with the drama and its active episodes locked `FOR UPDATE` and verifies a SHA-256 fingerprint before any write. |
| Admin API             | `POST /admin/api/dramas/convert-to-movie`; requires `drama.manage` and same-origin mutations.                                                                                                                                                                                                              |
| Admin page            | `/admin/dramas/[id]/convert-to-movie`; the `/admin/dramas` listing shows the action only when `activeEpisodes === 1`.                                                                                                                                                                                      |
| Validation            | `src/modules/content/validation.ts` (`movieConversionRequestSchema`) and `src/modules/content/movie-conversion.ts` (plan, publication mapping, fingerprint).                                                                                                                                               |

`ratings` and `reviews` are now dual-target tables (D-020):

| Item              | Detail                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target columns    | `drama_id uuid NULL`, `movie_id uuid NULL`.                                                                                                                                                                                         |
| Exactly-one CHECK | `ck_ratings_target` / `ck_reviews_target` require exactly one non-null target.                                                                                                                                                      |
| FKs               | `fk_*_drama_id` → `dramas.id`, `fk_*_movie_id` → `movies.id` (cross-module FKs in SQL).                                                                                                                                             |
| Uniqueness        | `uq_ratings_user_id_drama_id_active` / `uq_ratings_user_id_movie_id_active` (soft delete aware) and `uq_reviews_user_id_drama_id` / `uq_reviews_user_id_movie_id` (reviews have no soft delete).                                    |
| Lookup indexes    | `idx_ratings_drama_id`, `idx_ratings_movie_id`, `idx_reviews_drama_id`, `idx_reviews_movie_id`.                                                                                                                                     |
| Conversion write  | One `UPDATE` per table sets `movie_id` and clears `drama_id`, preserving moderation state, timestamps, and soft-delete flags. `review_reactions` and `review_reports` reference `review_id` only and follow their review untouched. |

The reviews, users, notifications, and analytics modules export narrow
content-ownership services that accept the workflow's transaction; the
workflow does not write their tables directly. The conversion itself is
one-way; no movie→drama path exists.

### 8.6 Content Trash and anonymized ratings/reviews (Prompts 072–074)

The Trash reuses the `deleted_at` column that every content table already
carries. A cascade is identified by the *value* of that column, not by a new
column or table.

| Item                | Detail                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trashed columns     | `dramas.deleted_at`, `seasons.deleted_at`, `episodes.deleted_at`, `movies.deleted_at`.                                                                                                                                                        |
| Cascade timestamp   | Trashing a drama writes the **same** timestamp to the drama, its seasons, and its episodes in one transaction. Restoration selects the children whose `deleted_at` equals the parent's.        |
| Restoration guard   | A child is restored only when its parent is active. A conflicting slug, episode number, or season position is a conflict, never an automatic rename.                                                                                            |
| Permanent deletion  | Super Admin only. The row must already be trashed. A drama that was converted into a movie is refused (`fk_movies_converted_from_drama_id` is `ON DELETE RESTRICT`).                                                                        |
| Removed records     | `bookmarks`, `playback_progress`, `watched_state`, `watch_history`, analytics events and aggregates, notifications, `content_slug_history`, `content_seo`, `content_assets`, taxonomy joins, and similar-drama links. |
| Retained records    | `ratings` and `reviews` keep their value and text, lose `user_id` (set to `NULL`), lose their content target (set to `NULL`), and receive `anonymized_at = now()`.                                                                                  |
| Anonymization CHECK | `ck_ratings_target` / `ck_reviews_target` (migration `0011`) accept a targetless row only when `anonymized_at IS NOT NULL`. An ordinary row must still point at exactly one drama or movie.                                                    |
| Author CHECK        | `ck_ratings_anonymized_author` / `ck_reviews_anonymized_author` (migration `0012`) reject a row whose `anonymized_at IS NOT NULL` while `user_id` is still present, so an anonymized row can never keep its author.                                |
| Retention           | `TRASH_RETENTION_DAYS` (default 30). The expiry command is `scripts/trash-cleanup.mjs`, triggered by systemd, not by the application.                                                                                                        |
| Expiry locking      | The expiry command removes one candidate per transaction: it locks the row with `FOR UPDATE`, re-checks `deleted_at` under that lock, and removes the hierarchy in the same transaction. A candidate whose drama is the source of an existing movie is skipped, because `fk_movies_converted_from_drama_id` is `ON DELETE RESTRICT`. |

### 8.7 Direct video source workflow (Prompts 080–090)

Migration `drizzle/0013_video_source_workflow.sql` adds three tables. No column
stores a provider id, a claim id, an upload record, a staging path, or any
transcoding metadata: an episode carries one direct HTTPS URL and the tables
below carry metadata about it.

| Table                       | Module         | Purpose                                                                             | Key relationships                                                                                                                     | Indexes / constraints                                                                                                                                                      |
| --------------------------- | -------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subtitle_tracks`           | `playback`     | The subtitle files an episode offers: language, label, format, default selection, and the direct source URL the browser fetches | `episode_id` → `episodes.id` (`ON DELETE RESTRICT`)                         | `uq_subtitle_tracks_episode_id_language` (one track per language per episode), `uq_subtitle_tracks_episode_id_default` (at most one default per episode), `idx_subtitle_tracks_episode_id` |
| `playback_failure_reports`  | `playback`     | Viewer-reported failures of an external source, so an administrator can see which episodes do not play. The report never stores the source URL | `episode_id` → `episodes.id` (`ON DELETE RESTRICT`), `reported_by` → `users.id` (`ON DELETE SET NULL`) | `idx_playback_failure_reports_episode_id_created_at`, `idx_playback_failure_reports_created_at`, `idx_playback_failure_reports_reported_by` |
| `admin_audit_log`           | `administration` | The operational record of administrative actions that change what viewers receive. It records what happened, to which entity, by whom, and when — never the URL that was changed. `entity_id` is nullable (D-056): an action on a global homepage setting names the setting (`entity_type = 'homepage_setting'`) and no entity | `actor_id` → `users.id` (`ON DELETE SET NULL`)                              | `idx_admin_audit_log_entity_type_entity_id`, `idx_admin_audit_log_actor_id`, `idx_admin_audit_log_created_at` |

Notes:

- The three cross-module foreign keys are declared in the SQL migration only.
  A module may not import another module's `schema.ts`, so Drizzle cannot
  express them in the TypeScript schema.
- `subtitle_tracks.source_url` is validated as a direct HTTPS URL on the
  server, but the server never fetches it: the browser requests the subtitle
  file directly from the external host. There is no subtitle transcoding or
  conversion service.
- A failure report outlives the reporter: deleting a viewer account sets
  `reported_by` to `NULL` instead of deleting the operational record or
  blocking the account deletion.
- The source-replacement reset reuses the existing `playback_progress`,
  `watched_state`, and `watch_history` tables — no new table is introduced for
  it. `watch_history` rows and their historical dates are deliberately left
  untouched by the reset.
- `episodes.video_source` holds the direct URL and nothing else. The ordinary
  episode update refuses to change it; replacement is a separate transactional
  operation that also resets viewer progress and writes the audit record.

### 8.8 Source version and restrictive playback foreign keys (Prompts 080–090 review fixes)

Migration `drizzle/0014_video_source_version.sql` adds one column and changes
the deletion behaviour of the two cross-module playback foreign keys.

| Change | Detail |
| ------ | ------ |
| `episodes.video_source_version` | `integer NOT NULL DEFAULT 1`. The column counts the source versions of an episode: it starts at `1` and a confirmed replacement increments it. It is the staleness guard for playback progress — see §8.7 and D-041. |
| `fk_subtitle_tracks_episode_id` | Changed from `ON DELETE CASCADE` to `ON DELETE RESTRICT`. |
| `fk_playback_failure_reports_episode_id` | Changed from `ON DELETE CASCADE` to `ON DELETE RESTRICT`. |

Why the deletion behaviour changes:

- A cascading delete let a `content` deletion remove another module's rows
  without that module's knowledge — the `playback` rows vanished silently and
  the `playback` module could not audit or account for them.
- A restrictive foreign key refuses the deletion instead. The permanent-delete
  workflow therefore calls the `playback` module's own purge service
  (`purgeEpisodePlaybackReferences`) inside the same transaction, and only then
  deletes the episode. The module that owns the rows removes them.
- The consequence reaches every code path that hard-deletes an episode. The
  production path is `src/workflows/admin/permanent-delete.ts`; the end-to-end
  fixtures (`tests/e2e/support/drama-fixture.mjs` and
  `tests/e2e/support/stale-fixtures.mjs`) remove the playback rows before the
  episodes for the same reason.

Migration properties:

- Reversible: `ALTER TABLE episodes DROP COLUMN video_source_version;` restores
  the `0013` column set, and re-adding the two constraints with
  `ON DELETE CASCADE` restores the previous deletion behaviour. No row is
  rewritten by the migration itself.
- The column has a `DEFAULT 1` and is `NOT NULL`, so the existing rows are
  backfilled by PostgreSQL without a table rewrite of the data.
- The two constraints are re-added `NOT VALID`, matching the convention of the
  other cross-module foreign keys: the migration cannot abort on legacy data,
  and the constraint is validated by `npm run db:integrity`.


### 8.9 Analytics and notification data model (Prompts 139–154)

Migration `drizzle/0018_analytics_and_notifications.sql` completes the data
model of the analytics and notification domains.

#### Columns

| Table                | Change             | Detail                                                                                                   |
| -------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `content_view_events`   | `deleted_at`       | `timestamptz null`. A soft-deleted event leaves the counts and the deduplication indexes.                 |
| `playback_analytics_events` | `deleted_at`   | `timestamptz null`. Same rule.                                                                             |
| `search_events`          | `deleted_at`   | `timestamptz null`. Same rule.                                                                             |
| `playback_analytics_events` | `episode_id`  | `uuid null`, `ON DELETE restrict`. A playback event names the episode that was watched; the typed `drama_id` / `movie_id` columns still name the parent, so the dashboard can roll episode playback up to its drama. |
| `notification_preferences` | `new_drama`  | `boolean NOT NULL DEFAULT true`. Requirements §11.1 asks for five independent event preferences; the shared `new_drama_season` column only ever covered the season case. |

#### Foreign keys

| Constraint                                     | Target              | Deletion behaviour |
| ---------------------------------------------- | ------------------- | ------------------ |
| `fk_content_view_events_guest_session_id`      | `guest_sessions.id` | `ON DELETE set null` |
| `fk_playback_analytics_events_guest_session_id` | `guest_sessions.id` | `ON DELETE set null` |
| `fk_search_events_guest_session_id`            | `guest_sessions.id` | `ON DELETE set null` |
| `fk_playback_analytics_events_episode_id`      | `episodes.id`       | `ON DELETE restrict` |

The guest-session keys use `set null` because an analytics event outlives the
visitor row it was attributed to: the retention policy removes the visitor,
not the measurement. The episode key uses `restrict` because an episode is
content, and content is not silently removed by a foreign key (D-042). All
three are added `NOT VALID` and are validated by `npm run db:integrity`.

#### Deduplication indexes

| Index                                  | Columns                                                                    | Rule |
| -------------------------------------- | -------------------------------------------------------------------------- | ---- |
| `uq_guest_sessions_session_id`         | `session_id`                                                               | One active row per anonymous session identifier. |
| `uq_guest_sessions_user_id`            | `user_id` (partial: `user_id IS NOT NULL`)                                  | One active row per linked account; the visitor key stays stable across requests. |
| `uq_content_view_events_dedup`         | `content_id, content_type, guest_session_id, viewed_hour_bucket`             | One view per visitor, content item, and hour. The six-hour rolling window is applied by the application on top of this safety net (D-058). |
| `uq_playback_analytics_events_dedup`   | `content_id, content_type, guest_session_id, event_type, event_hour_bucket`   | One playback event of each type per visitor, content item, and hour. This is the bound that keeps playback analytics from becoming a per-second log (D-060). |
| `uq_search_events_dedup`               | `guest_session_id, search_hour_bucket`                                       | One search per guest session and hour. |
| `uq_notification_preferences_active`   | `user_id`                                                                   | One active preference row per account. |
| `uq_push_subscriptions_active`         | `user_id, endpoint`                                                         | One active subscription per account and browser endpoint. |

Every index is partial (`WHERE deleted_at IS NULL`), so a soft-deleted row
does not block a new one.

#### Query indexes

| Index                                            | Serves |
| ------------------------------------------------ | ------ |
| `idx_content_view_events_visitor_window`         | The six-hour window lookup: a visitor's recent views of one content item. |
| `idx_content_view_events_viewed_at`              | The range-level view and distinct-viewer reads. |
| `idx_playback_analytics_events_event_at`         | The range-level playback and watch-time reads. |
| `idx_playback_analytics_events_episode_id`       | The per-episode playback lookup. |
| `idx_analytics_daily_aggregates_date`            | The dashboard's date-range read of the stored aggregates. |
| `idx_analytics_daily_aggregates_content`         | The per-content performance rows. |
| `idx_notifications_user_recent`                  | The notification centre's history read. |
| `idx_notifications_user_unread`                  | The unread-count read. |
| `idx_notification_deliveries_notification`       | The delivery-attempt history of one notification. |
| `idx_announcements_publication_status`           | The published-announcement list. |

Migration properties:

- Reversible: every statement is an additive column, an additive constraint,
  or a `CREATE INDEX IF NOT EXISTS`. The rollback drops the indexes and the
  constraints and drops the added columns; no row is rewritten by the
  migration itself.
- The `episode_id` foreign key is `NOT VALID`, matching the convention of the
  other cross-module foreign keys: the migration cannot abort on legacy data,
  and the constraint is validated by `npm run db:integrity`.

#### Retention indexes (migration `0019`)

| Index                                        | Serves |
| -------------------------------------------- | ------ |
| `idx_guest_sessions_created_at`             | The expired anonymous sessions the retention command removes. It is partial (`WHERE user_id IS NULL`), because a session row linked to an account is never removed. |
| `idx_search_events_searched_at`             | The expired search events. |
| `idx_playback_analytics_events_guest_session` | The "does an event still point at this session?" check of the guest-session removal. |

Without them the retention command would read a whole table on every run, which
is the unbounded query requirements §10.4 forbids. The command itself is
`npm run db:analytics:retention`; the policy is D-065.

---

## 9. Change Process

1. Read `CONVENTIONS.md` §5 and this document.
2. Confirm the table belongs to the module making the change.
3. Update the module's `schema.ts` and add a migration.
4. Update this catalog.
5. Update this document's relationship/index notes.
6. Run typecheck, integration tests, and migration checks.
7. Record a decision if ownership, identity strategy, or a destructive change is involved.
8. Update `PROJECT_STATUS.md`.

Do not modify another module's table. Do not add a cross-module write to avoid a workflow.

## 8. Index and Search Strategy (Updated)

- **Every foreign key** has an index on the referencing column (per CONVENTIONS.md §5.4).
- **Partial unique indexes** WHERE deleted_at IS NULL enforce active-row uniqueness for slugs, names, and per-user/per-content constraints.
- **Full-text indexes** (idx_*_search, GIN on svector) support title/description search on dramas, episodes, and movies.
- **Trigram indexes** (idx_*_title_trgm, GIN on pg_trgm) support autocomplete and fuzzy matching on title columns.
- **Composite indexes** support common query patterns: drama-level lookups, season/episode ordering, category/platform joins, and user-specific filtering.
- **Case-insensitive uniqueness** on lower(name) is enforced via partial unique indexes where names must be unique among active rows.
