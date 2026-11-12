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

| Item                   | Status                                             |
| ---------------------- | -------------------------------------------------- |
| PostgreSQL connection  | Configured (Prompt 019)                            |
| Drizzle schema modules | Implemented, 42 tables (Prompts 020–029)           |
| Migrations             | Configured and applied (Prompt 040)                |
| Tables                 | 42 implemented (see §8)                           |
| Seed data              | Reference data only; no seed command yet           |
| Test database          | Builds from migrations (`TEST_DATABASE_URL`)       |

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
| `users`          | `bookmarks`                                                                                                                                                                                                                                                              |
| `playback`       | `subtitle_tracks`, `playback_progress`, `watch_history`, `episode_watch_state`                                                                                                                                                                                           |
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

| Serves | Does not serve |
| --- | --- |
| The default scope `deleted_at IS NULL` (the index predicate), used when `status` is absent, `active`, or `deactivated`. | The `deleted` filter: its predicate is `deleted_at IS NOT NULL`, the complement of the index predicate. No btree index on `created_at` can support it, so the filter is a sequential scan over the deleted subset. |
| The default sort `created_at DESC`. | The free-text search: `ILIKE` against `name` and `email` with escaped wildcards. It remains a sequential scan until query-plan evidence justifies a trigram index. |
| The default listing's access path (`deleted_at IS NULL` → `created_at DESC`); a sort step remains for tied rows (limitation 2 below). | The residual `active` / `deactivated` / `superAdmin` predicates, which are evaluated after the index scan rather than by the index. |

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

| Query (filter, sort, page) | Chosen path | Partial index used? | Execution time |
| --- | --- | --- | --- |
| `deleted_at IS NULL`, `ORDER BY created_at DESC, id ASC`, `LIMIT 20 OFFSET 0` | Seq Scan + sort | No | 0.210 ms |
| `deleted_at IS NULL AND is_active`, same sort and page | Seq Scan + sort | No | 0.056 ms |
| `deleted_at IS NULL AND NOT is_active`, same sort and page | Seq Scan + sort | No | 0.067 ms |
| `deleted_at IS NOT NULL`, same sort and page | Seq Scan + sort | No | 0.054 ms |

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

---

## 7. Migrations

Migration tooling and practices are defined in `CONVENTIONS.md` §10. Database-specific rules:

- Migrations live in `drizzle/` and are numbered sequentially.
- The applied baseline is `drizzle/0000_boring_harry_osborn.sql` (50 statements, 42 tables), generated from the complete schema with `drizzle-kit generate` and applied with `drizzle-kit migrate`. Its snapshot is `drizzle/meta/0000_snapshot.json` and its journal entry is `drizzle/meta/_journal.json`.
- `drizzle/0001_pale_earthquake.sql` adds login monitoring (`login_attempts`) and session activity.
- `drizzle/0002_information_page_footer_links.sql` adds `information_pages.position`, the active-row slug uniqueness index, the partial footer index, and the six-row information-page seed (forward-only; the seed is idempotent and preserves administrator edits).
- `drizzle/0003_needy_infant_terrible.sql` adds one partial index, `idx_users_active_created_at`, for the admin user listing (Prompt 051). See §6.1 for the queries it serves, the queries it does not serve, and the measured plans.
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

| Table | Module | Purpose                   | Status  |
| ----- | ------ | ------------------------- | ------- |
| dramas              | content      | Dramas ( TV/streaming series ) | ✅ Implemented |
| seasons             | content      | Seasons per drama              | ✅ Implemented |
| episodes            | content      | Episodes per season            | ✅ Implemented |
| movies              | content      Standalone films                 | ✅ Implemented |
| categories          | content      Content taxonomies           | ✅ Implemented |
| platforms           | content      Streaming platforms        | ✅ Implemented |
| drama_categories    | content      Drama–category many-to-many | ✅ Implemented |
| drama_platforms     | content      Drama–platform many-to-many | ✅ Implemented |
| movie_categories    | content      Movie–category many-to-many | ✅ Implemented |
| movie_platforms     | content      Movie–platform many-to-many | ✅ Implemented |
| similar_dramas      | content      Similarity recommendations | ✅ Implemented |
| information_pages   | content      Legal/information pages and footer configuration | ✅ Implemented |
| content_slug_history| content      Slug change history        | ✅ Implemented |
| content_seo         | content      SEO metadata per content  | ✅ Implemented |
| content_assets      | content      Media/assets per content  | ✅ Implemented |
| sitemap_exclusions  | content      Sitemap URL exclusions    | ✅ Implemented |
| users_bookmarks     | users        User bookmarks            | ✅ Implemented |
| users_watch_history | users        Watch history            | ✅ Implemented |
| users_watched_state | users        Per-episode watched state | ✅ Implemented |
| users_bookmarks     | users        User bookmarks           | ✅ Implemented |
| ratings             | reviews      User ratings (1–5)        | ✅ Implemented |
| reviews             | reviews      User reviews            | ✅ Implemented |
| review_reactions    | reviews      Review reactions (likes) | ✅ Implemented |
| review_reports      | reviews      Review reports         | ✅ Implemented |
| content_reports     | moderation   User content reports   | ✅ Implemented |
| moderation_actions  | moderation   Admin moderation actions | ✅ Implemented |
| notification_preferences | notifications | User notification preferences | ✅ Implemented |
| notifications       | notifications   In-app notifications | ✅ Implemented |
| push_subscriptions  | notifications   Push subscription endpoints | ✅ Implemented |
| notification_deliveries | notifications   Delivery tracking records | ✅ Implemented |
| announcements       | notifications   Site-wide announcements | ✅ Implemented |
| admin_notifications | notifications   Admin-targeted notifications | ✅ Implemented |
| users               | auth         Auth users (Better Auth) | ✅ Implemented |
| accounts            | auth         OAuth/account linking   | ✅ Implemented |
| sessions            | auth         Auth sessions           | ✅ Implemented |
| verifications       | auth         Email/email OTP verifications | ✅ Implemented |
| roles               | authorization | Role definitions (built-in and custom) | ✅ Implemented |
| permissions         | authorization | Per-role `(resource, action)` grants and revocations | ✅ Implemented |
| user_roles          | authorization | User ↔ role assignments (many-to-many) | ✅ Implemented |
| guest_sessions      | analytics    Anonymous guest sessions | ✅ Implemented |
| content_view_events | analytics    Content view events        | ✅ Implemented |
| playback_analytics_events | analytics   Playback analytics events | ✅ Implemented |
| analytics_daily_aggregates | analytics   Daily aggregate metrics | ✅ Implemented |
| search_events       | analytics    Search event logs        | ✅ Implemented |
| users_playback_progress | playback   Playback progress tracking | ✅ Implemented |
| users_subtitle_tracks | playback   Subtitle track assignments | ✅ Implemented |
| admin_accounts      | administration   Admin user accounts  | ⏳ Pending migration |
| admin_login_attempts| administration   Admin login attempts | ⏳ Pending migration |
| admin_session_events| administration   Admin session events | ⏳ Pending migration |
| system_settings     | administration   System configuration | ⏳ Pending migration |
| system_setting_versions | administration   System setting versions | ⏳ Pending migration |
| admin_dashboard_layouts | administration   Admin dashboard layouts | ⏳ Pending migration |
| admin_audit_log     | administration   Admin audit log    | ⏳ Pending migration |
| maintenance_task_runs | maintenance   Scheduled maintenance runs | ⏳ Pending migration |
| backup_manifests    | maintenance   Backup file manifests | ⏳ Pending migration |
| system_alerts       | maintenance   System alerts          | ⏳ Pending migration |
| incidents           | maintenance   Incident reports       | ⏳ Pending migration |
| incident_notes      | maintenance   Incident notes         | ⏳ Pending migration |
| incident_attachments| maintenance   Incident attachments   | ⏳ Pending migration |
| error_records       | maintenance   Error record log       | ⏳ Pending migration |
| health_snapshots    | maintenance   Health check snapshots | ⏳ Pending migration |

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

| Item | Detail |
| ---- | ------ |
| Purpose | Administrator-managed legal and information pages (Terms, Privacy, Community Guidelines, Copyright/DMCA, About, Contact). |
| Primary key | `id uuid` (`uuidv7()` default). |
| Key columns | `title`, `slug`, `content`, `publication_status` (`draft`/`published`/`unpublished`), `preview`, `footer_visible`, `position`. |
| Timestamps / soft delete | `created_at`, `updated_at`, `deleted_at` (`timestamptz`). Trash is `deleted_at IS NOT NULL`. |
| Constraints | `uq_information_pages_slug_active` — partial unique index on `slug WHERE deleted_at IS NULL`, so a slug may be reused after soft delete. |
| Indexes | `idx_information_pages_footer` — partial index on `position WHERE deleted_at IS NULL AND publication_status = 'published' AND footer_visible = true`, supporting the public footer query. |
| Ordering | `position` ascending; null positions sort last, then title and id for determinism. Reordering is transactional. |
| Migration | `drizzle/0002_information_page_footer_links.sql` (schema + idempotent six-row seed). |
| Query/service API | `src/modules/content/information-pages.ts` (`listFooterInformationLinks`, `getPublishedInformationPage`, `listInformationPages`, `updateInformationPage`, `reorderInformationPages`). |
| Admin API | `GET /admin/api/information-pages`, `PATCH /admin/api/information-pages/[id]`, `PUT /admin/api/information-pages/reorder`; requires `settings.manage`. |
| Public visibility | Published, footer-visible, non-deleted rows with a valid single-segment slug only. Drafts are never rendered publicly. |

The seed inserts exactly six published, footer-visible rows with body
`This page is being prepared.` and positions 1–6. It uses
`ON CONFLICT ("slug") WHERE "deleted_at" IS NULL DO NOTHING`, so re-running the
statement is harmless and administrator-edited content is never overwritten.

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
- **Full-text indexes** (idx_*_search, GIN on 	svector) support title/description search on dramas, episodes, and movies.
- **Trigram indexes** (idx_*_title_trgm, GIN on pg_trgm) support autocomplete and fuzzy matching on title columns.
- **Composite indexes** support common query patterns: drama-level lookups, season/episode ordering, category/platform joins, and user-specific filtering.
- **Case-insensitive uniqueness** on lower(name) is enforced via partial unique indexes where names must be unique among active rows.
