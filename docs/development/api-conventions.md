# API Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08  

This document defines the REST and Server Action response conventions, derived from `CONVENTIONS.md` §6 and established by Prompt 004. It is the human-readable contract for endpoints and application operations. The OpenAPI document is the machine-readable contract.

---

## 1. Base Path and Format

- Internal REST endpoints live under `/api`.
- JSON only: `Content-Type: application/json; charset=utf-8`.
- JSON fields are **camelCase**; database columns are snake_case and mapped in DTOs.
- IDs are strings (UUIDv7 for application entities).
- Timestamps are ISO 8601 UTC strings with milliseconds.
- Enum values are lowercase snake_case strings.
- Use `null` for explicit absence; do not omit a documented field.
- Initial endpoints are not versioned. A future external API is introduced under `/api/v1` with a recorded decision.

---

## 2. Success Envelopes

### Single Resource

```json
{ "data": { "id": "0198f3a2-...", "title": "Example" } }
```

### Collection

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

---

## 3. Errors

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

- Stable codes: `validation_error`, `authentication_required`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal_error`, plus documented domain codes.
- HTTP status: `200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`, `429`, `500`.
- Public unavailable content returns `404`, not `403`.
- Ownership violations on private resources return `404` where `403` would leak existence.
- Permission failures on known admin resources return `403`.
- Never expose SQL, stack traces, internal paths, credentials, or raw provider errors.

---

## 4. Pagination, Sorting, and Filtering

- `page` (1-based, default 1), `pageSize` (default 20, maximum 100).
- `sort` is a comma-separated allowlist of API fields; `-` means descending: `?sort=-publishedAt,title`.
- Multi-value filters use repeated parameters: `?category=action&category=romance`.
- Free text uses `q`.
- Date ranges use `from`/`to` with ISO dates; analytics interprets them in Asia/Dhaka.
- All parameters are validated with Zod. No arbitrary column names or SQL fragments.

---

## 5. Authentication and Authorization

- REST uses the same session cookie as the application.
- Every protected endpoint documents its required permission key.
- REST authorization matches the equivalent Server Action and service authorization.
- Deactivated accounts are rejected before the operation runs.
- Public content visibility is enforced server-side, including for guessed URLs and direct API calls.

---

## 6. CSRF, Caching, and Rate Limiting

- Cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`.
- Server Actions use Next.js origin protections; REST mutations additionally validate same-origin `Origin`/`Sec-Fetch-Site`.
- Public GETs may use short shared cache lifetimes with tag invalidation. Private/admin responses use `no-store`.
- Rate-limited endpoints return `429` with `Retry-After`. Rate limiting is PostgreSQL-backed, not Redis.

---

## 7. Server Action Results

Server Actions never throw raw errors across the boundary. They return the same `ActionResult<T>` union as REST:

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

Server Actions may call `revalidateTag` after a successful mutation.

---

## 7. OpenAPI and Documentation

- The OpenAPI document is served at `/api/openapi`; Swagger UI at `/api/docs`.
- Generate schemas from Zod where practical; keep a single source of truth for request/response shapes.
- Every endpoint documents: method, path, auth requirement, permission key, request schema, response schema, error cases, pagination/sorting/filtering, and rate limit.
- Server Actions are documented in `API.md` as application operations with their permission keys and result shape, even though they are not REST endpoints.
- The OpenAPI document must not expose secrets or internal-only fields.
- CI should validate that the OpenAPI document builds. A contract test is added when the API is implemented.

---

## 8. Change Process

1. Read `CONVENTIONS.md` §6–§8 and this document.
2. Confirm the operation belongs in REST (allowlist) or a Server Action.
3. Implement the service/workflow first; the entrypoint adapts it.
4. Enforce authentication and authorization at the entrypoint and re-check in the service.
5. Add tests for success, validation, authorization, not-found, conflict, and rate-limit cases.
6. Update this document and the OpenAPI document.
7. Update `PROJECT_STATUS.md` and `CHANGELOG.md`.

Do not add a REST endpoint for an operation that belongs in a Server Action. Do not implement parallel business logic in two entrypoints.