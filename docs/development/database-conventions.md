# Database Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08

This document defines the database naming, modeling, and migration conventions, derived from `CONVENTIONS.md` §5 and established by Prompt 004. It is the application-specific implementation of those conventions and must not be contradicted without a new recorded decision.

---

## 1. Core Rules

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

---

## 2. Standard Columns

Most application-owned tables include:

| Column       | Type          | Notes                                                 |
| ------------ | ------------- | ----------------------------------------------------- |
| `id`         | `uuid`        | Primary key, UUIDv7, server-generated                 |
| `created_at` | `timestamptz` | `not null default now()`                              |
| `updated_at` | `timestamptz` | `not null default now()`, set by repository on update |
| `deleted_at` | `timestamptz` | `null` unless soft-deleted                            |

Additional columns are table-specific and documented in the catalog.

---

## 3. Ownership Map

Each module owns its schema file and tables. The planned ownership is:

| Module           | Planned tables                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`           | `users`, `accounts`, `sessions`, `verifications` (Better Auth schema plus account status)                                                                                                                                                                                |
| `authorization`  | `roles`, `permissions`, `user_roles`                                                                                                                                                                                                                 |
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
    Prompt 020 chose typed FK columns plus a check constraint; see `DATABASE.md` §5 for the recorded model. Do not use an unenforced polymorphic `content_id` without a documented integrity strategy.
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
| —     | —      | No tables implemented yet | Planned |

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
