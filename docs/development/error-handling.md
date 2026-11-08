# Error Handling Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08  

This document defines the error handling conventions, derived from `CONVENTIONS.md` §7 and established by Prompt 004. It covers the error hierarchy, rules for services and entrypoints, and client response mapping.

---

## 1. Error Hierarchy

`platform/errors` owns the base `AppError` with a stable `code`, a safe message, optional field errors, and an internal cause. Subclasses are defined below.

| Error | Meaning | HTTP | Server Action Result |
|---|---|---|---|
| `ValidationError` | Invalid input | 400 | `{ ok: false, code, fieldErrors }` |
| `AuthenticationError` | No/invalid session | 401 | `{ ok: false, code }` |
| `AuthorizationError` | Authenticated but not permitted | 403 | `{ ok: false, code }` |
| `NotFoundError` | Missing or not visible | 404 | `{ ok: false, code }` |
| `ConflictError` | State conflict, duplicate, invariant violation | 409 | `{ ok: false, code }` |
| `RateLimitError` | Limit exceeded | 429 | `{ ok: false, code, retryAfter }` |
| `InternalError` | Unexpected failure | 500 | `{ ok: false, code: "internal" }` |

Domain errors may extend these classes (for example, `ContentNotPlayableError extends ConflictError` with code `content_not_playable`). They must not invent new transport semantics.

---

## 2. Rules for Services

- Services throw typed errors. They never return HTTP objects or status codes.
- `platform/http` maps errors to REST responses once. `app` maps them to `ActionResult` once.
- Internal details (SQL, stack traces, credentials, URLs with tokens) never reach the client.
- Unknown errors are wrapped as `InternalError`, logged with full context, and returned as a generic message.
- Services accept a logging context; they do not create ad-hoc loggers.

---

## 3. Rules for Entrypoints

### 3.1 Server Components

- Resolve actor, call one or more module query services, render.
- Do not mutate data, access repositories or the DB, or call write services.

### 3.2 Server Actions

- Parse `FormData`, validate with Zod, resolve actor, call one workflow or one module service, map errors, revalidate cache tags.
- Do not contain domain rules, access the DB, or duplicate REST logic.

### 3.3 REST Route Handlers

- Parse request (params/query/body), resolve actor, call one workflow or one module service, map result/errors to HTTP, set headers.
- Do not contain domain rules, access the DB, or implement logic not present in the shared service.

---

## 4. Error Mapping to HTTP

`platform/http` maps errors to HTTP responses. The mapping is applied once and consistently:

| Error | HTTP | Client Response |
|---|---|---|
| `ValidationError` | 400 | `{ error: { code: "validation_error", message, fieldErrors, requestId } }` |
| `AuthenticationError` | 401 | `{ error: { code: "authentication_required", message, requestId } }` |
| `AuthorizationError` | 403 | `{ error: { code: "forbidden", message, requestId } }` |
| `NotFoundError` | 404 | `{ error: { code: "not_found", message, requestId } }` |
| `ConflictError` | 409 | `{ error: { code: "conflict", message, requestId } }` |
| `RateLimitError` | 429 | `{ error: { code: "rate_limited", message, requestId, retryAfter } }` |
| `InternalError` | 500 | `{ error: { code: "internal_error", message, requestId } }` |

Client-facing messages are safe; causes and stack traces stay in logs.

---

## 5. Logging Correlation

- `requestId` correlates the client response with server logs and is returned as `X-Request-Id`.
- Unexpected errors are logged with a stack trace and wrapped as `internal_error`.
- Error-monitoring records store safe metadata only, with a bounded default retention (30 days) and redaction.
- Administrator audit records capture actor, action, target, result, and time without capturing secrets.

---

## 5. Progress Tracker Conventions

This document defines the progress tracker format, as specified in `CONVENTIONS.md` §13 and `DECISIONS.md` D-016.

| Field | Description |
|---|---|
| Prompt Number | Original micro-prompt number (e.g., `004`) |
| Prompt Title | Name of the implementation prompt (e.g., `Create project documentation and development conventions`) |
| Status | Not Started / In Progress / Completed / Blocked |
| Changed Files | Files created, modified, or removed |
| Tests | Tests executed and their results (command and outcome, or `N/A` with reason) |
| Unresolved Issues | Remaining problems or decisions requiring approval |
| Completion Date | Date of completion (ISO format, e.g., `2026-11-08`) |

A prompt is not complete until its status row, the next task, and applicable changelog or decision entries are accurate.

---

## 6. Definition of Done

A prompt is complete only when all applicable items are true:

- The requested behavior is implemented, not merely rendered.
- Server-side authorization and validation are enforced.
- Type checking passes.
- Linting and formatting pass.
- Relevant unit/integration tests pass; new behavior has tests.
- Production build passes.
- No excluded infrastructure or dependency was introduced.
- No mock data, fake ratings, or fake view counts were added.
- Database changes have reviewed migrations with a documented rollback/forward-fix plan.
- API changes update `API.md` and the OpenAPI document.
- UI changes cover loading, empty, error, and responsive states and meet accessibility requirements.
- `PROJECT_STATUS.md` records prompt number, status, changed files, tests, and unresolved issues.
- `CHANGELOG.md` and `DECISIONS.md` are updated when applicable.
- Unverified behavior and known limitations are reported honestly.

For a documentation-only prompt, "tests" is `N/A` with the reason, and the document is checked for consistency against `REQUIREMENTS.md`, `ARCHITECTURE.md`, and active decisions.