
# Changelog

## Unreleased

### Added

- **Prompt 039:** Centralized authorization guards in `src/modules/authorization`. Canonical `resource.action` permission catalog (`permissions.ts`), server-side actor resolution (`actors.ts`), effective-permission union (`service.ts`), and reusable guards (`guards.ts`) for `requireUser`, `requireAdmin`, `requirePermission`, `requireAnyPermission`, and `assertResourceAccess`. Unit tests cover allowed/denied roles, anonymous actors, Super Admin, revoked permissions, and deactivated/soft-deleted accounts.
- **Prompts 033/034:** Database-backed authentication policies and hooks. `src/platform/auth/auth-policy.ts` holds the pure Super Admin and session decisions; `auth-hooks.ts` wires them to PostgreSQL; `session.ts` exposes `getActiveSession` for protected pages. The Better Auth catch-all handler is mounted at `src/app/api/auth/[...all]/route.ts`.
- **Prompt 040:** Initial Drizzle migration baseline `drizzle/0000_boring_harry_osborn.sql` (50 statements, 42 tables) with `drizzle/meta/0000_snapshot.json` and `drizzle/meta/_journal.json`. The baseline was generated from the complete schema and applied to the empty local `dramascan` database with `drizzle-kit migrate`.
- **Prompt 033/034 tests:** Unit coverage for normalization, promotion decisions, session decisions, the database hook, and `getActiveSession`; a Better Auth schema-diff test (`schemaCheckFor(context.adapter)`); and real-database integration tests for session blocking, bootstrap idempotency, case-insensitive email matching, "never promote when one exists", and concurrent promotion races.

### Changed

- **Prompt 039(A):** Reconciled the RBAC schema with the canonical catalog. `roles`, `permissions`, and `user_roles` moved from `src/modules/auth/schema.ts` to `src/modules/authorization/schema.ts` to match documented module ownership. The physical `(resource, action)` pair remains, now with a catalog-derived exact-key CHECK constraint, a unique `(role_id, resource, action)` rule, a unique role name, a unique `(user_id, role_id)` assignment, role foreign keys, and an index on `user_roles.role_id`. No second catalog exists.
- **Prompts 033/034:** `src/modules/auth/schema.ts` now implements Better Auth 1.7's canonical `users`, `sessions`, `accounts`, and `verifications` model. TypeScript keys use Better Auth's camelCase field names while physical columns stay snake_case. The custom Google callback route was deleted in favor of the Better Auth catch-all handler with `nextCookies()`. `src/modules/authorization/actors.ts` reads the renamed `users.isSuperAdmin`, `users.isActive`, and `users.deletedAt` columns.
- **Prompt 040:** `drizzle.config.ts` now reads `dbCredentials.url` and `package.json` maps `db:migrate` to `drizzle-kit migrate` (generating before `db:push`). `tests/global-setup.ts` builds `dramascan_test` from migrations instead of `drizzle-kit push`.
- **Prompt 040:** `uuidPrimaryKey()` now includes `.primaryKey()`. The generated baseline previously created tables without primary keys because the helper returned a bare column; every application-owned table now emits `id uuid PRIMARY KEY DEFAULT uuidv7()`. `user_roles` and the content join tables use named composite primary keys instead of a separate unique constraint.

### Fixed

- **Schema cleanup:** Fixed the pre-existing `analytics` and `notifications` schema defects. `analytics/schema.ts` now calls the shared helpers (`createdAt()`, `updatedAt()`, `deletedAt()`) per table instead of passing helper functions as column builders, and imports `timestamp`; `notifications/schema.ts` now calls `.defaultNow()` instead of referencing the method. This restores `tsc`, the full 42-table `drizzle-kit generate`, and the schema-registry test. Also added the missing end-of-file newline in five files reported by `eol-last` and repaired a corrupted `### Fixed` heading in this changelog.
- **Prompt 039:** `AppError` now preserves the concrete subclass prototype (`new.target.prototype`). Previously `AuthenticationError`/`AuthorizationError` failed `instanceof` checks and mapped to `500` instead of `401`/`403`.
- **Prompts 033/034:** `/dashboard` is now a Server Component that reads `getActiveSession`, so a signed-out or deactivated visitor is redirected instead of rendering a session-checking defect; `/auth/signin` redirects an active session to `/dashboard`.
- **Prompt 040:** Corrected the generated baseline so the Better Auth `sessions.user_id` foreign key can be created (the auth tables previously had no primary key to reference). The baseline dry-run applies all 50 statements inside a rolled-back transaction.

### Security

- **Prompt 039:** Server Actions no longer accept an actor argument. Each privileged workflow resolves the actor from the server-side session and re-checks the permission, so a client cannot forge identity, roles, Super Admin state, or permissions. Admin REST routes resolve the actor and guard before dispatch.
- **Prompt 039:** Actor resolution reads `is_super_admin`, `is_active`, and `deleted_at` from the database (the authority). Deactivated and soft-deleted users are treated as anonymous even if a session cookie is still valid. Stored permission rows that are not in the canonical catalog are ignored (deny by default).
- **Prompts 033/034:** `databaseHooks.session.create.before` rejects session creation for deactivated and soft-deleted users, and `getActiveSession` re-checks the database on every protected render. Deactivation therefore invalidates an existing session cookie immediately, even though Better Auth's `/api/auth/get-session` still reports the session.
- **Prompts 033/034:** First-sign-in Super Admin bootstrap promotes only the normalized `SUPER_ADMIN_EMAIL`, only while no Super Admin exists, and under a transaction-scoped PostgreSQL advisory lock (`pg_advisory_xact_lock`). There is no self-service promotion endpoint or UI.
- **Prompt 040:** No secrets were added. `.env.local` was read for verification only and remains untracked; the migration contains no credentials.

---

## Earlier prompts

- **Prompt 039:** Centralized server-side authorization guard implementation with canonical permission catalog reconciliation.
- **Prompt 028:** Analytics data models. src/modules/analytics/schema.ts defines guest_sessions, content_view_events, playback_analytics_events, nalytics_daily_aggregates, and search_events tables. Supports anonymous guest sessions, bounded playback event aggregation (no per-second writes), content view counting with 6-hour deduplication windows, daily aggregates, and search events. Keeps personal identifiers separate from anonymous analytics. UUID primary keys, snake_case naming, and soft delete. Typecheck: next typegen passes; build compiles. Lint, test (17 tests) pass.

### Fixed

- **Prompt 004:** Corrected a self-referential instruction in `DATABASE.md` Â§9 so the
  change process says to update "this document's relationship/index notes."

### Removed

- Nothing removed.

### Security

- **Prompt 004:** Established security documentation requirements: server-side
  authorization as the sole authority, deny-by-default behavior, no secret exposure in
  logs/exports/errors, no server-side fetching of arbitrary administrator media URLs, and
  fail-closed rate limiting for sensitive operations. No control is implemented yet.
- **Prompt 019:** Database credentials remain server-only. Connection validation errors
  never include passwords, and pool errors are logged with connection URLs, password
  fragments, and URL credentials redacted.

---

## Release History

No releases yet. The first release entry is added when a deployable application exists.






