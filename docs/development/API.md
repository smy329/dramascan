# API

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Document:** REST and Server Action contracts
**Version:** 1.0
**Date:** 2026-11-08
**Status:** Conventions established by Prompt 004. No endpoints are implemented yet.

**Authority chain:** `AGENTS.md` → `REQUIREMENTS.md` → `DECISIONS.md` → `ARCHITECTURE.md` → `CONVENTIONS.md` → this document.

`CONVENTIONS.md` §6–§8 defines the response, error, and logging conventions. This document is the human-readable contract for endpoints and application operations. The OpenAPI document is the machine-readable contract.

---

## 1. Status

| Item | Status |
|---|---|
| REST endpoints | None implemented |
| Server Actions | None implemented |
| OpenAPI document | Not generated |
| Swagger UI | Not configured |
| Authentication | Not integrated (Prompt 030+) |

Do not describe planned endpoints as available.

---

## 2. General Conventions

### 2.1 Base path and format

- Internal REST endpoints live under `/api`.
- JSON only: `Content-Type: application/json; charset=utf-8`.
- JSON fields are camelCase; database columns are snake_case and mapped in DTOs.
- IDs are strings (UUIDv7 for application entities).
- Timestamps are ISO 8601 UTC strings with milliseconds.
- Enum values are lowercase snake_case strings.
- Use `null` for explicit absence.
- Initial endpoints are not versioned. A future external API is introduced under `/api/v1` with a recorded decision.

### 2.2 Success responses

Single resource:

```json
{ "data": { "id": "0198f3a2-...", "title": "Example" } }
```

Collection:

```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 123,
    "totalPages": 7,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

- `201 Created` returns the created resource in `data`.
- `204 No Content` returns an empty body.
- No `success` field.

### 2.3 Errors

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request contains invalid fields.",
    "fieldErrors": { "title": ["Title is required."] },
    "requestId": "01J..."
  }
}
```

Stable codes: `validation_error`, `authentication_required`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal_error`, plus documented domain codes.

HTTP status: `200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`, `429`, `500`.

- Public unavailable content returns `404`, not `403`.
- Ownership violations on private resources return `404` where `403` would leak existence.
- Permission failures on known admin resources return `403`.
- Never expose SQL, stack traces, internal paths, credentials, or raw provider errors.

### 2.4 Pagination, sorting, and filtering

- `page` (1-based, default 1), `pageSize` (default 20, maximum 100).
- `sort` is a comma-separated allowlist of API fields; `-` means descending: `?sort=-publishedAt,title`.
- Multi-value filters use repeated parameters: `?category=action&category=romance`.
- Free text uses `q`.
- Date ranges use `from`/`to`; analytics interprets them in Asia/Dhaka.
- All parameters are validated with Zod. No arbitrary column names or SQL fragments.

### 2.5 Authentication and authorization

- REST uses the same session cookie as the application.
- Every protected endpoint documents its required permission key.
- REST authorization matches the equivalent Server Action and service authorization.
- Deactivated accounts are rejected before the operation runs.
- Public content visibility is enforced server-side, including for guessed URLs and direct API calls.

### 2.6 CSRF, caching, and rate limiting

- Cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`.
- Server Actions use Next.js origin protections; REST mutations additionally validate same-origin `Origin`/`Sec-Fetch-Site`.
- Public GETs may use short shared cache lifetimes with tag invalidation. Private/admin responses use `no-store`.
- Rate-limited endpoints return `429` with `Retry-After`. Rate limiting is PostgreSQL-backed, not Redis.

### 2.7 Server Action results

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string[]>;
        requestId?: string;
      };
    };
```

Server Actions never throw raw errors across the boundary. They use the same error codes and safe messages as REST.

---

## 3. REST Endpoint Catalog

Status values: **Planned**, **Implemented**, **Deprecated**.

### 3.1 Authentication

| Method | Path | Auth | Permission | Purpose | Status |
|---|---|---|---|---|---|
| `GET/POST` | `/api/auth/[...all]` | Public | — | Better Auth handler: sign-in, callback, session, sign-out | Planned |

### 3.2 Public reads

| Method | Path | Auth | Permission | Purpose | Status |
|---|---|---|---|---|---|
| `GET` | `/api/search/suggestions` | Public | — | Live autocomplete with poster thumbnails, recent/popular suggestions | Planned |

Public page data is rendered by Server Components through module query services, not REST. Do not add REST endpoints for ordinary page reads.

### 3.3 Analytics beacons

| Method | Path | Auth | Permission | Purpose | Status |
|---|---|---|---|---|---|
| `POST` | `/api/analytics/view` | Public (guest session or user) | — | Record a deduplicated content view for a drama or movie | Planned |
| `POST` | `/api/analytics/playback` | Public (guest session or user) | — | Record bounded playback events (start, progress milestone, completion) | Planned |

Beacons are small, idempotent/deduplicated, and bounded. They never write on every playback second. The final split between progress persistence and analytics events is settled in the playback prompt.

### 3.4 Playback

| Method | Path | Auth | Permission | Purpose | Status |
|---|---|---|---|---|---|
| `POST` | `/api/playback/progress` | Authenticated | `playback.progress.write` (own records) | Persist debounced playback progress and watched state | Planned |

Progress updates carry a client timestamp; the server rejects older updates that would overwrite newer progress.

### 3.5 Notifications

| Method | Path | Auth | Permission | Purpose | Status |
|---|---|---|---|---|---|
| `GET` | `/api/notifications/unread-count` | Authenticated | Own notifications | Poll the unread count for the notification bell | Planned |

Push subscription management is a Server Action, not REST.

### 3.6 Administration

| Method | Path | Auth | Permission | Purpose | Status |
|---|---|---|---|---|---|
| `GET` | `/api/admin/exports/[dataset]` | Super Admin | `export.dataset` | Download an approved CSV dataset | Planned |
| `GET` | `/api/admin/backups/[id]` | Super Admin | `backup.download` | Download an authorized backup | Planned |

Admin page reads use Server Components. Admin mutations use Server Actions.

### 3.7 Operations

| Method | Path | Auth | Permission | Purpose | Status |
|---|---|---|---|---|---|
| `GET` | `/api/health` | Public (minimal) | — | Application and dependency health | Planned |
| `GET` | `/api/health/details` | Admin | `health.read` | Detailed diagnostics | Planned |
| `GET` | `/api/openapi` | Public | — | OpenAPI JSON document | Planned |
| `GET` | `/api/docs` | Public | — | Swagger UI | Planned |

Public health responses expose only minimal status. Detailed diagnostics are admin-only.

---

## 4. Server Action Catalog

Server Actions are application operations, not REST endpoints. They are documented here with their permission keys and result shape.

| Area | Operations | Permission examples | Status |
|---|---|---|---|
| Authentication | Sign out, revoke own session | — | Planned |
| Profile | View private profile | — | Planned |
| Bookmarks | Add, remove, toggle | Own bookmarks | Planned |
| Playback | Mark watched/unwatched, remove from Continue Watching | Own progress | Planned |
| Reviews | Submit/update rating, submit/edit review, react, report review | Authenticated | Planned |
| Content reports | Submit a content report | Authenticated, rate-limited | Planned |
| Notifications | Update preferences, mark read/unread, manage push subscription | Own notifications | Planned |
| Content administration | Create/update/publish/unpublish/trash/restore content, seasons, episodes, movies | `drama.*`, `episode.*`, `movie.*` | Planned |
| Source replacement | Replace an episode or movie source after preview and confirmation | `episode.replace_source`, `movie.replace_source` | Planned |
| Taxonomy administration | Create/update/delete categories and platforms | `category.*`, `platform.*` | Planned |
| Moderation | Resolve content reports, remove reviews | `report.resolve`, `review.moderate` | Planned |
| User administration | Deactivate/reactivate users | `user.deactivate` | Planned |
| Admin administration | Authorize/deactivate admins, assign roles, terminate sessions | `admin.*` | Planned |
| System configuration | Update settings, restore a version, maintenance mode | `settings.update`, `maintenance_mode.update` | Planned |
| CSV import | Dry run and apply metadata import | `import.dataset` | Planned |

Every action validates input with Zod, resolves a trusted actor, calls one service or workflow, and returns `ActionResult`.

---

## 5. Endpoint Documentation Template

When an endpoint is implemented, add a section with:

```markdown
### GET /api/example

- **Status:** Implemented
- **Auth:** Authenticated / Public / Admin
- **Permission:** `example.read`
- **Rate limit:** 60 requests/minute per user
- **Query parameters:** `page`, `pageSize`, `sort`, `q`, ...
- **Request body:** (schema or link to Zod schema)
- **Success:** `200` with `{ data, meta }`
- **Errors:** `400 validation_error`, `401 authentication_required`, `403 forbidden`, `404 not_found`, `429 rate_limited`
- **Caching:** `no-store`
- **Notes:** visibility rules, ownership rules, side effects
- **OpenAPI operationId:** `example.list`
```

---

## 6. OpenAPI

- The OpenAPI document is served at `/api/openapi`; Swagger UI at `/api/docs`.
- Generate schemas from Zod where practical; keep a single source of truth for request/response shapes.
- Every endpoint documents authentication, permissions, validation, responses, and error cases.
- The OpenAPI document must not expose secrets or internal-only fields.
- CI should validate that the OpenAPI document builds. A contract test is added when the API is implemented.

---

## 7. Change Process

1. Read `CONVENTIONS.md` §6–§8 and this document.
2. Confirm the operation belongs in REST (allowlist) or a Server Action.
3. Implement the service/workflow first; the entrypoint adapts it.
4. Enforce authentication and authorization at the entrypoint and re-check in the service.
5. Add tests for success, validation, authorization, not-found, conflict, and rate-limit cases.
6. Update this document and the OpenAPI document.
7. Update `PROJECT_STATUS.md` and `CHANGELOG.md`.

Do not add a REST endpoint for an operation that belongs in a Server Action. Do not implement parallel business logic in two entrypoints.
