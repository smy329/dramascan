# DATABASE

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Document:** Database schema, relationships, and migration notes
**Version:** 1.0
**Date:** 2026-11-08
**Status:** Conventions established by Prompt 004. Modular schema structure established by Prompt 020; no tables exist yet. Table models begin in Prompt 022.

**Authority chain:** `AGENTS.md` → `REQUIREMENTS.md` → `DECISIONS.md` → `ARCHITECTURE.md` → `CONVENTIONS.md` → this document.

This document is the source of truth for the implemented database. Until the data-model prompts (022+) add tables, the table catalog below is a plan, not an implemented schema.

---

## 1. Status

| Item                   | Status                                       |
| ---------------------- | -------------------------------------------- |
| PostgreSQL connection  | Configured (Prompt 019)                      |
| Drizzle schema modules | Structure established (Prompt 020)           |
| Migrations             | Not configured (Prompt 021)                  |
| Tables                 | None (data models begin in Prompt 022)       |
| Seed data              | None                                         |
| Test database          | Not configured locally (`TEST_DATABASE_URL`) |

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
- Application-owned IDs default to PostgreSQL `uuidv7()` on the server. This requires PostgreSQL 18 or newer; CI and local development use PostgreSQL 18. Better Auth-managed tables keep Better Auth's required ID type; foreign keys to the auth user table use that same type.
- Intra-module foreign keys use named Drizzle constraints. Cross-module foreign keys are added as SQL constraints in migrations and are not declared in `schema.ts`; they do not grant write permission.
- The registry is intentionally empty until the data-model prompts add tables. No module directory gains service, query, or repository files until that module's implementation prompt.

---

## 3. Ownership Map

Each module owns its schema file and tables. The planned ownership is:

| Module           | Planned tables                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`           | `users`, `accounts`, `sessions`, `verifications` (Better Auth schema plus account status)                                                                                                                                                                                |
| `authorization`  | `roles`, `permissions`, `role_permissions`, `user_roles`                                                                                                                                                                                                                 |
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

---

## 7. Migrations

Migration tooling and practices are defined in `CONVENTIONS.md` §10. Database-specific rules:

- Migrations live in `drizzle/` and are numbered sequentially.
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
| information_pages   | content      Static pages ( About, FAQ ) | ✅ Implemented |
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
