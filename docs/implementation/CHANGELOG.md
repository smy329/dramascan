
# Changelog

## Unreleased

### Added

- **Prompt 039:** Centralized authorization guards in `src/modules/authorization`. Canonical `resource.action` permission catalog (`permissions.ts`), server-side actor resolution (`actors.ts`), effective-permission union (`service.ts`), and reusable guards (`guards.ts`) for `requireUser`, `requireAdmin`, `requirePermission`, `requireAnyPermission`, and `assertResourceAccess`. Unit tests cover allowed/denied roles, anonymous actors, Super Admin, revoked permissions, and deactivated/soft-deleted accounts.

### Changed

- **Prompt 039(A):** Reconciled the RBAC schema with the canonical catalog. `roles`, `permissions`, and `user_roles` moved from `src/modules/auth/schema.ts` to `src/modules/authorization/schema.ts` to match documented module ownership. The physical `(resource, action)` pair remains, now with a catalog-derived exact-key CHECK constraint, a unique `(role_id, resource, action)` rule, a unique role name, a unique `(user_id, role_id)` assignment, role foreign keys, and an index on `user_roles.role_id`. No second catalog exists.

### Fixed

- **Schema cleanup:** Fixed the pre-existing `analytics` and `notifications` schema defects. `analytics/schema.ts` now calls the shared helpers (`createdAt()`, `updatedAt()`, `deletedAt()`) per table instead of passing helper functions as column builders, and imports `timestamp`; `notifications/schema.ts` now calls `.defaultNow()` instead of referencing the method. This restores `tsc`, the full 42-table `drizzle-kit generate`, and the schema-registry test. Also added the missing end-of-file newline in five files reported by `eol-last` and repaired a corrupted `### Fixed` heading in this changelog.
- **Prompt 039:** `AppError` now preserves the concrete subclass prototype (`new.target.prototype`). Previously `AuthenticationError`/`AuthorizationError` failed `instanceof` checks and mapped to `500` instead of `401`/`403`.

### Security

- **Prompt 039:** Server Actions no longer accept an actor argument. Each privileged workflow resolves the actor from the server-side session and re-checks the permission, so a client cannot forge identity, roles, Super Admin state, or permissions. Admin REST routes resolve the actor and guard before dispatch.
- **Prompt 039:** Actor resolution reads `is_super_admin`, `is_active`, and `deleted_at` from the database (the authority). Deactivated and soft-deleted users are treated as anonymous even if a session cookie is still valid. Stored permission rows that are not in the canonical catalog are ignored (deny by default).

---

## Earlier prompts

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






