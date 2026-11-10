# SECURITY

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Document:** Security principles, planned controls, and known limitations
**Version:** 1.0
**Date:** 2026-11-08
**Status:** Conventions established by Prompt 004. No security control is implemented yet; implementation begins in later prompts.

**Authority chain:** `AGENTS.md` → `REQUIREMENTS.md` → `DECISIONS.md` → `ARCHITECTURE.md` → `CONVENTIONS.md` → this document.

`REQUIREMENTS.md` §12 defines the required security behavior. `CONVENTIONS.md` §6–§9 defines how API, errors, logging, and tests must be written. This document records how those requirements are applied, what is not yet implemented, and which risks are explicitly accepted.

**Do not describe a planned control as implemented.** Update the status column when a control lands.

---

## 1. Status

| Area                                                 | Status                                   | Implemented in             |
| ---------------------------------------------------- | ---------------------------------------- | -------------------------- |
| Authentication (Google OAuth via Better Auth)        | **Implemented**                          | **Prompts 033/034**        |
| Session and cookie security                          | **Implemented** (session gate; header/CSP hardening pending) | **Prompts 033/034** |
| RBAC and server-side authorization                   | **Implemented**                          | **Authorization phase (Prompt 039)** |
| Input validation with Zod                            | Not implemented                          | Per feature                |
| Environment configuration validation (server-only)   | **Implemented**                          | Prompt 009                 |
| Rate limiting (PostgreSQL-backed)                    | Not implemented                          | Auth/abuse-prone features  |
| HTTP security headers and CSP                        | Not implemented                          | Foundation/security phase  |
| Structured logging with redaction                    | **Implemented**                          | Prompt 016                 |
| PostgreSQL connection pool, URL validation, timeouts | **Implemented**                          | Prompt 019                 |
| Database role separation and local-only access       | Operator-managed deployment prerequisite | Server setup (Prompt 019+) |
| Image upload validation                              | Not implemented                          | Media phase                |
| Backup integrity and restore validation              | Not implemented                          | Maintenance phase          |
| Error monitoring records                             | Not implemented                          | Operations phase           |

Until a control is implemented and tested, treat the corresponding threat as unmitigated.

---

## 2. Core Principles

1. **Server-side authorization is the only security authority.** Hiding a button, menu item, or route is never sufficient. Every protected page, Server Action, REST endpoint, and domain service enforces effective permissions.
2. **Deny by default.** Missing permission, missing session, unknown resource state, and ambiguous ownership all fail closed.
3. **Validate at every boundary.** Client validation is a convenience. The server re-validates all untrusted input with Zod and domain rules.
4. **Least privilege.** Users, administrators, database roles, and maintenance commands receive only the access they need.
5. **No secret reaches the client, logs, exports, or error messages.** Server secrets use server-only environment variables; no `NEXT_PUBLIC_` prefix.
6. **Fail safely.** Errors return stable, non-revealing messages. Internal detail stays in logs with a correlation ID.
7. **Do not weaken global security to fix one integration.** CSP, cookie, and header policy changes are scoped, documented, and reviewed.
8. **Security behavior is tested.** Authorization, validation, rate limits, and visibility rules have automated tests, not just manual checks.

---

## 3. Authentication and Accounts

- **Provider:** Google OAuth only, through Better Auth with PostgreSQL. No password login, email/password registration, additional OAuth providers, custom profile names, custom avatars, public user profiles, account switching, or self-service deletion.
- **First Super Admin:** bootstrapped from an environment-configured authorized Google email. There is no public setup wizard and no endpoint that grants arbitrary elevation.
- **Deactivated accounts:** cannot use authenticated features. Historical data is retained, not deleted.
- **Account identity:** the platform stores only what is needed for authentication and display. It does not store Google credentials or unnecessary profile data.
- **Administrator separation:** public users cannot register as administrators. Administrator status is granted only by an authorized Super Admin.
- **Last Super Admin:** the system must prevent removal or deactivation of the last effective Super Admin. This invariant is enforced server-side inside a transaction, not only in the UI.

### 3.1 First-sign-in Super Admin bootstrap

Bootstrap is implemented by `src/platform/auth/auth-hooks.ts` through the Better Auth `databaseHooks.session.create.before` hook and the pure decisions in `src/platform/auth/auth-policy.ts`.

- Only the email in `SUPER_ADMIN_EMAIL`, compared case-insensitively after trimming and lower-casing, is eligible. A non-matching user is never promoted, even if the account is otherwise valid.
- Promotion happens only while no Super Admin exists. Existing Super Admin status always wins; a second eligible user is not promoted.
- The check and the promotion run inside one Drizzle transaction that first takes `pg_advisory_xact_lock(4627001033)`. Concurrent sign-ins therefore serialize: at most one promotion succeeds, the others observe the Super Admin that now exists. This is verified by a real-database race test.
- Promotion sets `users.is_super_admin = true`; it does not grant roles or write `user_roles`. Super Admin authorization is resolved from the column, and no role name is trusted.
- There is no self-service promotion endpoint, no promotion Server Action, and no API parameter that accepts a target user or role.
- If `SUPER_ADMIN_EMAIL` is unset, bootstrap is skipped entirely (`not-configured`); it never falls back to a default address.

### 3.2 Session creation gate and existing-session re-check

- `databaseHooks.session.create.before` calls `assertUserCanCreateSession` before Better Auth writes a session. A missing user, `is_active = false`, or non-NULL `deleted_at` fails with `403 ACCOUNT_NOT_ACTIVE`, so a new sign-in cannot create a session for a disabled account.
- Better Auth's own `/api/auth/get-session` validates the cookie and expiry but does not consult application account status. Protected pages therefore use `getActiveSession` (`src/platform/auth/session.ts`), which loads the session and then re-reads the user row.
- `getActiveSession` returns `null` when the user is missing, inactive, soft-deleted, or the session has expired. `/dashboard` redirects to `/auth/signin` in that case, and `/auth/signin` redirects to `/dashboard` only for an active session.
- Deactivating a user therefore invalidates an existing session cookie on the next protected request. The cookie and the `sessions` row may still exist; the database status is the authority.

### 3.3 Administrator session policy

- Configurable inactivity timeout and maximum session lifetime, enforced server-side.
- Super Admin can inspect administrator sessions, terminate one or more sessions, and force reauthentication.
- Successful and failed administrator logins, repeated failures, and suspicious patterns are recorded without storing credentials.
- Temporary restrictions may be applied after repeated failures.
- Super Admin receives dashboard alerts for security-relevant events.
- Session revocation after Google-side security changes happens only when the change is reliably detectable. The platform does not claim real-time Google security-event integration.

---

## 4. Authorization (RBAC)

- Permissions are canonical `resource.action` keys from the catalog in `src/modules/authorization/permissions.ts` (for example `drama.update`, `episode.read`, `review.moderate`, `admin.manage`). Nothing outside the authorization module defines permission identifiers.
- An administrator may hold multiple roles; effective permissions are the union of granted permissions across assigned roles. Revoked rows (`granted = false`) do not grant access.
- The database is the authority for actor state. `resolveActor` loads `is_super_admin`, `is_active`, and `deleted_at`; deactivated or soft-deleted accounts resolve to an anonymous actor even if a session cookie is still valid. Super Admin resolves to the complete catalog without any role-name comparison.
- The database enforces the canonical pair: `permissions` stores `resource` + `action` with a CHECK constraint generated from the full catalog key list, a unique `(role_id, resource, action)` constraint, and a role foreign key. Duplicate grants and non-catalog pairs are impossible; `granted = false` records an explicit revocation without deleting history.
- Initial roles: Super Admin, Content Manager, Moderator, Analyst. Super Admin may create custom roles and assign permissions.
- Permission checks happen in `authorization` and are re-applied by the domain service that performs the operation. A route handler or Server Action may not be the only check. Server Actions resolve the actor internally and never accept an actor or identity argument from the caller.
- Guards throw typed errors: `AuthenticationError` maps to `401 authentication_required`, `AuthorizationError` maps to `403 forbidden` through `platform/http`. Both REST handlers and Server Actions use the same guard semantics.
- Ownership checks are part of authorization. A user may read or change only their own bookmarks, progress, history, reviews, reactions, reports, and notification preferences unless an explicit permission grants broader access.
- **Response semantics:**
  - Public unavailable content (draft, unpublished, trashed, or nonexistent) returns `404`, never `403`.
  - Private-resource ownership violations return `404` where `403` would reveal existence.
  - Permission failures on known admin resources return `403`.
- REST and Server Action authorization must match. The same service guard is used by both entrypoints (`DECISIONS.md` D-010).
- Visibility is enforced in query services, including for guessed URLs and direct API calls.

### 4.1 Authorization test requirements

Every permission key requires tests for: allowed role, denied role, missing session, deactivated account, and cross-user ownership attempt. The last-Super-Admin invariant requires a dedicated test. See `CONVENTIONS.md` §9.3.

---

## 5. Input Validation and Output Safety

- All untrusted input is parsed with Zod on the server. Parsed output is the source of truth; do not cast.
- Validate query parameters, path parameters, form bodies, JSON bodies, headers used for security decisions, cookies, uploaded file metadata, and imported CSV rows.
- **SQL injection:** use Drizzle parameterization. Never concatenate client input into SQL. Sort and filter fields come from an allowlist, never arbitrary column names.
- **XSS:** rely on React escaping. Do not use `dangerouslySetInnerHTML` with untrusted content. Any rich text is sanitized with an allowlist before storage and rendering.
- **Open redirects:** redirect targets are validated against an allowlist of internal paths. Do not redirect to a client-supplied absolute URL.
- **Path traversal:** file access uses validated identifiers, not client-supplied paths. Stored filenames are generated server-side; display names are metadata only.
- **Mass assignment:** input schemas list allowed fields explicitly. Never spread a request body into a database update.
- **URL validation:** video, subtitle, image, and attachment URLs require HTTPS (except documented local development), a valid host, and no embedded credentials. See §7.
- **CSV import:** validate headers, row count, field types, lengths, and referential targets. Import runs as a preview/dry run followed by an explicit confirmed apply. Never execute formulas or evaluate imported content.

---

## 6. Sessions, Cookies, CSRF, and Rate Limiting

### 6.1 Cookies and sessions

- Session cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`, with an appropriate path and bounded lifetime.
- Trusted origins are configured explicitly for the application and Google OAuth callback.
- Session identifiers are rotated or revoked on sign-out, deactivation, administrator termination, and forced reauthentication.
- No session token, OAuth token, or secret is stored in `localStorage` or exposed to client JavaScript.

### 6.2 CSRF

- Server Actions rely on Next.js origin protections and same-origin checks.
- REST mutations additionally validate `Origin`/`Sec-Fetch-Site` as same-origin.
- State-changing operations never use `GET`.
- CORS is not opened to arbitrary origins. If a cross-origin need appears, it requires an explicit decision.

### 6.3 Rate limiting

- PostgreSQL-backed rate limiting, not Redis.
- Applied to authentication-related endpoints, report submission, reviews, sensitive admin operations, push subscription changes, and other abuse-prone operations.
- Limits are keyed by identity and request context; anonymous requests use a privacy-conscious guest session or network context where appropriate.
- Exceeding a limit returns `429` with `Retry-After`.
- **Rate-limiter failure must fail closed for sensitive operations.** A database error must not silently allow unlimited requests.
- Limits and windows are configuration, documented in `API.md` per endpoint.

---

## 7. External Media and URL Security

The platform plays administrator-supplied, public, direct HTTPS MP4 URLs. This has explicit security consequences.

- **No server-side fetch of arbitrary administrator URLs.** The server must not proxy, relay, download, or probe arbitrary URLs on behalf of an administrator. Preview verification happens in the browser.
- **No backend video proxy.** Playback goes directly from the viewer's browser to the external host.
- **HTTPS only** in production, with a valid host and no embedded credentials.
- **CORS and byte-range support** are required from the external host. A source that cannot be played in the preview is not publishable.
- **Compatibility is verified by actual playback**, not by an `.mp4` extension or a successful `HEAD` request.
- **Subtitle URLs** are validated for HTTPS and allowed format. Subtitle content is treated as untrusted data, not executable content.
- **Image assets** are validated for type, size, and dimensions. The initial version does not use Sharp or Next.js Image Optimization; stored originals are served as-is. Uploaded SVG is not accepted unless a sanitization strategy is approved.
- **CSP media permissions** are limited to required sources. Do not add an unrestricted wildcard `media-src` or `img-src` to make an external host work. A new host is added deliberately and documented.
- **Source URL confidentiality is not claimed.** The URL is visible to viewers and in network traffic. Do not describe it as hidden, DRM-protected, or access-controlled by the platform.

### 7.1 Source replacement

Replacing an episode or movie source is a consequential operation:

1. The administrator supplies the new HTTPS URL.
2. The browser preview must play successfully.
3. The administrator explicitly confirms the replacement.
4. The replacement is applied transactionally; progress for the affected episode is reset while watch-history records and their historical dates are preserved.
5. The old URL is not treated as secret and is not retained as a fallback unless the approved schema stores replacement history.

---

## 8. Database Security

- PostgreSQL is reachable only through the application server's local or private connection. It is never exposed to the public internet.
- Production uses local-only access, conservative connection limits, explicit timeouts, safe reconnection, and appropriate authentication.
- **Role separation:** a migration role holds DDL rights; the application role holds DML rights only. The application does not create or alter schema.
- The application does not auto-run migrations at startup in production.
- Connection strings and database passwords are server-only secrets.
- **Implemented (Prompt 019):** the application uses one server-only `pg` pool created from a Zod-validated `DATABASE_URL`, with a 5-connection maximum, explicit connect/idle/lifetime/statement/transaction timeouts, lazy reconnection, and redacted pool-error logging. Missing configuration fails with a safe `ConfigurationError`.
- Development database credentials are an operator-supplied prerequisite. They are never invented, documented as real values, or committed. Local values belong only in ignored environment files; `.env.example` contains safe placeholders only.
- Backups are protected and access-controlled; see §11.
- Queries use parameterization and least-privilege access. Reporting and read models do not gain write access.
- Guest session identifiers are pseudonymous analytics identifiers, not authentication credentials and not public profiles. They follow the documented retention policy.

---

## 9. Logging, Errors, and Monitoring

- Pino structured JSON logging with redaction for authorization headers, cookies, passwords, tokens, secrets, API keys, client secrets, and `set-cookie`.
- Never log request bodies by default, full media or subtitle URLs with query strings, OAuth tokens, session secrets, or credentials.
- Validation logs record field names and error codes, not sensitive values.
- Errors returned to clients use the stable error envelope in `CONVENTIONS.md` §6.5. They never include SQL, stack traces, internal paths, credentials, or raw provider errors.
- `requestId` correlates the client response with server logs and is returned as `X-Request-Id`.
- Unexpected errors are logged with a stack trace and wrapped as `internal_error`.
- Error-monitoring records store safe metadata only, with a bounded default retention (30 days) and redaction.
- Administrator audit records capture actor, action, target, result, and time without capturing secrets.

---

## 10. HTTP Security Headers and CSP

Planned controls:

- `Content-Security-Policy` with explicit `default-src`, `script-src`, `style-src`, `img-src`, `media-src`, `connect-src`, `frame-src`, and `frame-ancestors` values.
- `X-Content-Type-Options: nosniff`.
- Frame protection appropriate to the application (`frame-ancestors 'none'` unless a documented need exists).
- `Referrer-Policy` that avoids leaking sensitive URLs.
- `Permissions-Policy` limiting unnecessary browser capabilities.
- `Strict-Transport-Security` in production over HTTPS.
- No `unsafe-eval`. Inline script/style allowances are minimized and documented if required by a framework constraint.

Policies must remain compatible with Google OAuth, Vidstack, approved external MP4 hosts, and browser push. When an integration breaks under CSP, the fix is a specific allowlisted source, not a global wildcard.

---

## 11. Backup and Recovery Security

- Backups have a manifest with timestamp, database information, file size, and checksum.
- Integrity is validated automatically after creation; results are recorded and Super Admin is alerted on failure.
- The newest valid backup and the last known-good backup are protected from retention cleanup.
- A selected backup is validated before restore. Destructive restoration requires explicit confirmation and is followed by post-restore verification.
- **Accepted risk:** same-server backups may be destroyed together with the server. External backup copies, WAL archiving, point-in-time recovery, and incremental backups are not implemented in the initial version.
- Backup downloads are restricted to Super Admin and served through an authorized endpoint.
- Configuration export excludes secrets, OAuth credentials, session secrets, and other sensitive values.

---

## 12. Known Limitations and Deferred Controls

These are explicit, accepted limitations of the initial release. They are not hidden defects.

| Limitation                                       | Consequence                                                                       | Status                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| No DRM or source-URL protection                  | Media URLs are visible to viewers and can be shared                               | Accepted                                          |
| No backend media proxy                           | Playback depends on the external host's CORS, byte-range, and availability        | Accepted                                          |
| No email notifications                           | Security events are in-app/push only; no email fallback                           | Accepted                                          |
| No external object storage or CDN                | Media and images depend on the configured host/server                             | Accepted                                          |
| Same-server backups                              | Backup and server can be lost together                                            | Accepted (documented)                             |
| No WAL archiving / PITR / incremental backup     | Recovery point is the last valid backup                                           | Accepted                                          |
| No Sentry/Prometheus/Grafana                     | Monitoring is logs, health checks, alerts, and error records                      | Accepted                                          |
| No real-time Google security-event integration   | Some Google-side changes cannot trigger revocation                                | Accepted                                          |
| No password login or MFA managed by the platform | Security depends on the Google account                                            | Accepted                                          |
| No self-service account deletion                 | Deactivation is administrative                                                    | Accepted                                          |
| No Redis                                         | Rate limiting and caching are PostgreSQL-backed                                   | Accepted                                          |
| No external secret manager                       | Secrets live in server environment configuration                                  | Accepted                                          |
| No virus scanning of uploads                     | Image/subtitle/attachment uploads rely on type/size validation and access control | Accepted initially; revisit if attachments expand |
| No per-request database RLS                      | Authorization is enforced in the application layer                                | Accepted initially                                |

Deferred controls must not be presented as delivered. If a limitation becomes unacceptable, it requires a recorded decision and a scheduled prompt.

---

## 13. Security Verification

When a security-relevant feature is implemented, verify:

1. Missing session → `401`.
2. Authenticated but unauthorized → `403` (or `404` where existence must not leak).
3. Deactivated account → denied.
4. Cross-user ownership attempt → denied.
5. Last-Super-Admin removal → blocked inside a transaction.
6. Invalid, malformed, and oversized input → `400`, no stack trace.
7. Rate limit exceeded → `429` with `Retry-After`; limiter failure fails closed for sensitive operations.
8. Public unavailable content → `404` on both page and API paths.
9. REST and Server Action authorization parity.
10. Secrets absent from client bundles, logs, error responses, and configuration exports.
11. CSP and headers do not regress the approved integrations.
12. Security events appear in audit/notification records with safe metadata.

Report what was verified and what was not. Do not claim a control works because the code exists.

---

## 14. Change Process

1. Read `REQUIREMENTS.md` §12, `CONVENTIONS.md` §6–§9, and this document.
2. Identify the threat and the affected entrypoints (page, Server Action, REST, maintenance command).
3. Enforce authorization and validation in the service, not only the entrypoint.
4. Add tests for the cases in §13.
5. Update this document's status table and limitations.
6. Record a decision for any accepted risk, new trust boundary, or weakened control.
7. Update `PROJECT_STATUS.md` and `CHANGELOG.md`.

**Never** disable authorization, validation, CSRF protection, rate limiting, or logging redaction to make a feature pass. If a control blocks delivery, escalate the conflict instead of bypassing it.
