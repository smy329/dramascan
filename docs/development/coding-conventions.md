# Coding Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08  

This document contains the day-to-day coding rules, established by `CONVENTIONS.md` and binding until superseded by a recorded decision. It defines how code, data, tests, and documentation are written inside the architecture boundaries.

---

## 1. How to Understand Completed Work Before Changing It

Every developer or coding agent must do this before modifying the repository:

1. Read `PROJECT_STATUS.md` — current prompt, completed work, changed files, tests, unresolved issues, next task.
2. Read `DECISIONS.md` — active decisions. Do not contradict an active decision. If a change requires contradicting one, stop and ask for a new decision.
3. Read `ARCHITECTURE.md` — module boundaries, dependency direction, entrypoint allocation, data ownership, and transaction rules.
4. Read `CONVENTIONS.md` — naming, TypeScript, database, API, error, logging, testing, and migration rules.
5. Read the area-specific document: `DATABASE.md`, `API.md`, or `SECURITY.md`.
6. Inspect the relevant module's `index.ts` (its only public API), then its service/query/repository files, then its tests.
7. Search before creating. Use `grep`/`glob` to find an existing helper, service, type, or convention.
8. Run the current checks (typecheck, lint, tests) before changing behavior, so pre-existing failures are distinguishable from new ones.
9. Preserve working code, established architecture, public APIs, and user data unless the assigned prompt explicitly changes them.
10. Update `PROJECT_STATUS.md`, and `CHANGELOG.md`/`DECISIONS.md` when applicable, before declaring the prompt complete.

If the requested behavior is not established by the specification or an active decision, ask. Do not invent business rules, authorization behavior, or destructive semantics.

---

## 2. Directory Conventions

The full tree and layer rules are in `ARCHITECTURE.md` §4. Summary:

| Path | Purpose |
|---|---|
| `src/app/` | App Router routes, layouts, Server Actions, route handlers. Entrypoints only. |
| `src/workflows/` | Cross-module orchestration and transaction boundaries. |
| `src/modules/<domain>/` | Feature module: `index.ts` (public API), `schema.ts`, `repository.ts`, `queries.ts`, `service.ts`, `validation.ts`, optional `read-models/` or `providers/`. |
| `src/db/` | Composition root: schema registry and Drizzle client. |
| `src/platform/` | Server infrastructure: pool, transaction, config, errors, logging, rate limiting, cache, HTTP mapping. |
| `src/components/` | Client-safe UI. No data fetching, no module imports. |
| `src/lib/` | Isomorphic helpers and `lib/contracts/` client-safe DTOs/form schemas. |
| `src/scripts/maintenance/` | Short-lived systemd maintenance command entrypoints. |
| `drizzle/` | Generated and reviewed SQL migrations plus Drizzle metadata. |
| `public/` | Static, committed assets only. Not user uploads. |
| `tests/` | `unit/`, `integration/`, `e2e/`, `fixtures/`. |
| `docs/` | Project documentation directory. |

### 2.1 Route Conventions

- Route groups: `(public)`, `(auth)`, `admin`.
- URL segments are kebab-case: `/highest-rated`, `/watch-history`.
- Dynamic segments use framework syntax: `[id]`, `[slug]`, `[...all]`.
- Canonical content routes follow the specification exactly: `/drama/{stableId}/{slug}`, `/movie/{stableId}/{slug}`, `/drama/{dramaId}/{slug}/episode/{episodeId}`.
- Admin routes live under `/admin`; admin API routes under `/api/admin`.
- Do not create route files that contain business logic. They adapt HTTP or form input and call a service/workflow.

### 2.2 File Naming

| Kind | Convention | Example |
|---|---|---|
| Directories | kebab-case | `publish-content/`, `read-models/` |
| React component files | PascalCase | `DramaCard.tsx`, `PlayerShell.tsx` |
| All other TypeScript files | kebab-case | `content-service.ts`, `rate-limit.ts` |
| Next.js special files | Framework names | `page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `not-found.tsx` |
| Unit/integration tests | `<subject>.test.ts(x)` | `publish-content.test.ts` |
| End-to-end tests | `<flow>.spec.ts` | `admin-publish.spec.ts` |
| SQL migrations | `NNNN_short_description.sql` | `0001_create_auth_tables.sql` |
| Environment example | `.env.example` | committed |
| Local environment | `.env.local` | ignored |

Do not create barrel `index.ts` files for convenience. The only `index.ts` files are module public APIs and framework-required files.

---

## 3. Naming Conventions

### 3.1 TypeScript Identifiers

| Kind | Convention | Example |
|---|---|---|
| Variables, parameters, functions | camelCase | `dramaId`, `listEpisodes()` |
| Types, interfaces, classes, components | PascalCase | `DramaDetails`, `ContentService`, `DramaCard` |
| Constants and enum-like objects | UPPER_SNAKE_CASE | `MAX_PAGE_SIZE`, `PERMISSIONS` |
| Boolean variables | `is`/`has`/`can`/`should` prefix | `isPublished`, `hasNextPage`, `canPublish` |
| Private/internal module helpers | camelCase, not exported | `mapDramaRow()` |
| Zod schemas | `<Name>Schema` | `dramaInputSchema` |
| Inferred types | `<Name>` | `type DramaInput = z.infer<...>` |
| DTOs | `<Entity>Dto`, `<Entity>Summary`, `<Entity>Details` | `DramaSummaryDto` |
| Database row types | `<Entity>Row` (internal only) | `DramaRow` |
| Service inputs | `<Action>Input` | `PublishEpisodeInput` |
| Errors | `<Domain><Condition>Error` | `ContentNotPlayableError` |
| Permission keys | `resource.action` | `episode.publish`, `review.moderate` |
| Workflows | verb-first, kebab-case directory | `replace-video-source` |

### 3.2 Function Naming

| Prefix | Meaning |
|---|---|
| `get*` | Read one record; throws `NotFoundError` if required and missing |
| `find*` | Read one record or return `null` |
| `list*` | Read a collection with documented pagination/filters |
| `count*` | Return a numeric count |
| `search*` | Full-text/trigram search |
| `create*` | Insert a new record |
| `update*` | Update an existing record |
| `delete*` | Soft-delete (Trash) |
| `purge*` | Permanent deletion (Super Admin only) |
| `publish*` / `unpublish*` | Change publication state |
| `restore*` | Restore from Trash |
| `replace*` | Replace a source or value with explicit consequences |
| `assert*` | Throw a typed error when an invariant is false |
| `has*` / `can*` | Return a boolean capability check |
| `map*` | Convert a row/domain object to a DTO |
| `parse*` | Validate untrusted input with Zod |
| `handle*` | Entrypoint adapter (route handler, action, event) |

### 3.3 Module Public API Naming

- A module exports only from `index.ts`.
- Exports are named, never default (Next.js special files are the exception).
- Query functions are prefixed `get`/`find`/`list`/`count`/`search`.
- Mutation functions are prefixed `create`/`update`/`delete`/`publish`/`restore`/`replace`/`purge`.
- Do not export Drizzle tables, repositories, the DB client, or internal helpers.

### 3.4 Environment Variables

- `UPPER_SNAKE_CASE`.
- Server secrets never use the `NEXT_PUBLIC_` prefix.
- Public browser-safe values may use `NEXT_PUBLIC_` only when intentionally public.
- Required variables are validated by `platform/config` with Zod at startup.
- `.env.example` documents every variable with a safe placeholder and a comment.

---

## 4. TypeScript Standards

### 4.1 Compiler Settings

The project uses strict TypeScript. Required settings (implemented in Prompt 007):

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `forceConsistentCasingInFileNames: true`
- `moduleResolution: "bundler"`
- `target: "ES2022"`
- `jsx: "react-jsx"` (Next.js 16 automatic runtime)
- `incremental: true`
- `skipLibCheck: true` (application code is still fully checked)

No ignored type errors. `@ts-ignore` is forbidden. `@ts-expect-error` requires a comment explaining why and, where applicable, a linked issue.

### 4.2 Type Rules

1. **No `any`.** Use `unknown` for untrusted values and narrow with Zod or type guards.
2. **No unsafe assertions.** `as` is allowed only at a validated boundary or for a documented third-party limitation, with a comment. Prefer `satisfies` for config objects.
3. **Parse, don't cast.** Untrusted input is parsed with Zod; the parsed type is the source of truth.
4. **Prefer `type`.** Use `interface` only for intentionally extensible public contracts.
5. **No `enum`.** Use `as const` objects and union types:
   ```ts
   export const PUBLICATION_STATUSES = ["draft", "published", "unpublished"] as const;
   export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
   ```
6. **Discriminated unions for results.** Prefer `{ ok: true; data } | { ok: false; error }` over boolean flags plus nullable data.
7. **No non-null assertions (`!`).** Use explicit checks or `assert*` helpers. A justified exception requires a comment.
8. **No namespaces.** Use modules.
9. **`readonly` for immutable data.** Use `readonly` arrays/objects in DTOs and function parameters where mutation is not intended.
10. **Explicit return types on exported functions.** This keeps public APIs stable and reviewable.
11. **Type-only imports.** Use `import type` for types.
12. **No default exports** except Next.js special files.
13. **No floating promises.** Await or explicitly handle every promise; `void promise` only with a comment when fire-and-forget is intended.
14. **No `console.*` in application code.** Use the Pino logger.
15. **Dates are `Date` in TypeScript, ISO 8601 UTC strings at API boundaries, `timestamptz` in PostgreSQL.** Domain logic receives an injectable clock where time matters.

### 4.3 React and Next.js

- Server Components are the default. Add `"use client"` only for browser interactivity or client state.
- Do not fetch data in `components/`. Fetch in `app` Server Components via module query services, or in client components via approved REST endpoints/TanStack Query.
- Client Components receive serializable DTOs only.
- Forms use React Hook Form with Zod schemas from `lib/contracts`; submission uses a Server Action.
- Every data-driven screen implements loading, empty, error, and retry states where applicable.
- Use semantic HTML, labels, focus states, keyboard support, and adequate touch targets. Player accessibility follows the specification.
- Do not use Next.js Image Optimization or Sharp. Stored originals are served as-is.

---

## 5. Database Naming and Modeling

### 5.1 Naming

| Object | Convention | Example |
|---|---|---|
| Tables | plural `snake_case` | `dramas`, `episodes`, `content_reports` |
| Join tables | `<left>_<right>` plural | `drama_categories`, `user_roles` |
| Columns | `snake_case` | `published_at`, `episode_number` |
| Primary key | `id` | `id uuid primary key` |
| Foreign key | `<singular_referenced_table>_id` | `drama_id`, `episode_id`, `user_id` |
| Self-reference | role-based name | `parent_id`, `replaced_by_id` |
| Timestamps | `*_at`, `timestamptz` | `created_at`, `updated_at`, `deleted_at`, `published_at` |
| Booleans | `is_*` / `has_*` / `can_*` | `is_default`, `has_subtitles` |
| Enums | `*_status`, `*_type`, `*_reason` | `publication_status`, `content_type`, `report_reason` |
| Ordering | `position` | `position integer not null` |
| Slugs | `slug` | lowercase, URL-safe |
| Counts | `*_count`, `bigint` | `view_count`, `episode_count` |
| JSONB | `metadata` only for genuinely flexible data | not for core relational fields |

- Use `text` for strings unless a length limit is a real business rule. Validate lengths in Zod and with check constraints where appropriate.
- Use `uuid` for application primary keys (see §5.2).
- Use `timestamptz` for all timestamps; never `timestamp without time zone`.
- Use `numeric(3,2)` for rating averages and `smallint` with `CHECK (rating BETWEEN 1 AND 5)` for individual ratings.
- Use `bigint` for counters that can grow without a practical bound.
- Avoid database reserved words and quoted identifiers.
- Prefer real foreign keys. For relationships spanning dramas and movies, use typed FK columns with a check constraint or separate typed tables; do not use an unenforced polymorphic `content_id` without a documented integrity strategy.

### 5.2 Primary Keys

- Application-owned tables use **UUIDv7** stored as PostgreSQL `uuid`.
- UUIDv7 is time-ordered, non-enumerable, URL-safe, and stable across slug changes.
- IDs are generated server-side (application helper or database default) and never accepted from clients.
- Better Auth-managed tables follow Better Auth's required ID type. Foreign keys to the auth user table use that same type. This exception is documented in `DATABASE.md`.
- A public ID is never reused. Deleting and recreating content produces a new ID.

### 5.3 Timestamps, Soft Deletion, and Publication

- `created_at` and `updated_at` are `timestamptz not null default now()`.
- `updated_at` is set by the repository on every update. A database trigger is optional and, if added, must be documented.
- Trash is represented by `deleted_at timestamptz null`, not by a publication status value.
- Publication status uses a dedicated enum/domain type with `draft`, `published`, and `unpublished`. "Trashed" is derived from `deleted_at IS NOT NULL`.
- `published_at` records the actual publication time used by "Recently Added". It is not an editable fake date.
- Queries exclude `deleted_at IS NOT NULL` unless explicitly querying Trash.
- Soft-deleted rows do not block reuse of slugs or names: use partial unique indexes `WHERE deleted_at IS NULL`.

### 5.4 Constraints and Indexes

| Object | Naming | Example |
|---|---|---|
| Primary key | `pk_<table>` | `pk_dramas` |
| Foreign key | `fk_<table>_<column>` | `fk_episodes_drama_id` |
| Unique constraint/index | `uq_<table>_<columns>` | `uq_dramas_slug` |
| Check constraint | `ck_<table>_<rule>` | `ck_ratings_value_range` |
| Index | `idx_<table>_<columns>` | `idx_episodes_drama_id_position` |
| Partial unique index | `uq_<table>_<columns>_active` | `uq_dramas_slug_active` |
| Full-text index | `idx_<table>_search` | `idx_dramas_search` |
| Trigram index | `idx_<table>_<column>_trgm` | `idx_dramas_title_trgm` |

- Every foreign key has an index on the referencing column unless an existing composite index covers it.
- Every list query used in production has a supporting index, documented in `DATABASE.md`.
- Unique slugs are enforced per content table, with a partial index for active rows.
- Names that must be unique are compared case-insensitively using a `lower(name)` unique index.
- Full-text and trigram indexes are added when the search implementation lands (Prompt 020+).

### 5.5 Ownership

- Each table is owned by exactly one module (`ARCHITECTURE.md` §6, §10).
- No module writes another module's tables.
- Cross-module reads use the owner's public query API or an approved read model.
- Cross-module foreign keys are declared in SQL migrations, not by importing another module's `schema.ts`.

---

## 6. API Response Conventions

### 6.1 Base Path and Format

- Internal REST endpoints live under `/api`.
- JSON only, `Content-Type: application/json; charset=utf-8`.
- JSON field names are **camelCase**; database columns remain snake_case and are mapped in DTOs.
- IDs are strings.
- Timestamps are ISO 8601 UTC strings with milliseconds, e.g. `2026-11-08T12:34:56.000Z`.
- Enum values are lowercase snake_case strings, e.g. `"published"`, `"ongoing"`, `"not_playing"`.
- Use `null` for explicit absence; do not omit a documented field.

### 6.2 Success Envelope

Single resource:

```json
{
  "data": {
    "id": "0198f3a2-...",
    "title": "Example"
  }
}
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

- No `success: true` field. The HTTP status conveys success.
- `201 Created` for created resources, with the created representation in `data`.
- `204 No Content` for successful operations with no body.
- Do not wrap a collection in an object named after the resource (`{ "dramas": [...] }`). Use `data`.

### 6.3 Pagination

- Page-based by default: `page` (1-based, default `1`), `pageSize` (default `20`, maximum `100`).
- Responses always include `meta` for collections.
- Sorting must be deterministic: append a stable tiebreaker such as `id` when the requested sort is not unique.
- Never load an entire collection into memory. Admin tables and public discovery use server-side pagination.
- If a future endpoint requires cursor pagination for scale, it uses `cursor` and `limit` and returns `meta.nextCursor`; it must be documented in `API.md`.

### 6.4 Sorting and Filtering

- `sort` is a comma-separated list of API field names; `-` prefix means descending: `?sort=-publishedAt,title`.
- Only allowlisted fields are accepted; unknown fields are a validation error.
- Multi-value filters use repeated query parameters: `?category=action&category=romance`.
- Free-text search uses `q`.
- Date filters use `from`/`to` with ISO dates; analytics interprets ranges in Asia/Dhaka.
- All query parameters are validated with Zod. No raw SQL fragments or arbitrary column names from clients.

### 6.5 Error Envelope

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request contains invalid fields.",
    "fieldErrors": {
      "title": ["Title is required."]
    },
    "requestId": "01J..."
  }
}
```

- `code` is a stable snake_case string. `message` is safe for end users. `fieldErrors` is present only for validation failures.
- `requestId` is also returned in the `X-Request-Id` response header.
- Never expose SQL, stack traces, internal paths, credentials, or raw provider errors.
- Stable error codes: `validation_error`, `authentication_required`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal_error`, plus documented domain codes such as `slug_taken` or `content_not_playable`.

### 6.6 HTTP Status Codes

| Status | Use |
|---|---|
| `200 OK` | Successful read or update |
| `201 Created` | Resource created |
| `204 No Content` | Successful operation with no body |
| `400 Bad Request` | Validation failure, malformed input |
| `401 Unauthorized` | Missing or invalid session |
| `403 Forbidden` | Authenticated but not permitted |
| `404 Not Found` | Missing or intentionally hidden resource |
| `409 Conflict` | Duplicate, state conflict, invariant violation |
| `429 Too Many Requests` | Rate limit exceeded; include `Retry-After` |
| `500 Internal Server Error` | Unexpected failure |

- Public unavailable content returns `404`, never `403`, to avoid revealing unpublished or trashed content.
- Authenticated ownership violations on private resources return `404` where returning `403` would leak existence.
- Permission failures on known admin resources return `403`.

### 6.7 Authentication, CSRF, and Caching

- REST uses the same session cookie as the application. Authorization rules match Server Actions.
- Cookie settings are `HttpOnly`, `Secure` in production, `SameSite=Lax`, with an appropriate path.
- Server Actions rely on Next.js origin protections. REST mutations additionally validate `Origin`/`Sec-Fetch-Site` as same-origin.
- Public GET responses may use `Cache-Control` with short shared lifetimes and tag-based invalidation. Private responses use `Cache-Control: no-store`.
- Never cache authenticated, admin, or unpublished data in a shared cache.
- Rate-limited endpoints return `429` with `Retry-After`; rate limiting is PostgreSQL-backed, not Redis.

### 6.8 Server Action Results

Server Actions do not throw raw errors across the boundary. They return:

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

The same error codes and safe messages as REST apply. Server Actions may call `revalidateTag` after a successful mutation.

### 6.9 OpenAPI and Documentation

- The OpenAPI document is served at `/api/openapi`; Swagger UI at `/api/docs`.
- `API.md` is the human-readable contract and must stay in sync with the OpenAPI document.
- Every endpoint documents: method, path, auth requirement, permission key, request schema, response schema, error cases, pagination/sorting/filtering, and rate limit.
- Server Actions are documented in `API.md` as application operations with their permission keys and result shape, even though they are not REST endpoints.
- Initial endpoints are not versioned. A future external API is introduced under `/api/v1` with a recorded decision.

---

## 7. Error Handling

### 7.1 Error Hierarchy

`platform/errors` owns `AppError` and the base classes. Domain modules may extend them but must follow the same shape.

| Error | Code | HTTP |
|---|---|---|
| `ValidationError` | `validation_error` | 400 |
| `AuthenticationError` | `authentication_required` | 401 |
| `AuthorizationError` | `forbidden` | 403 |
| `NotFoundError` | `not_found` | 404 |
| `ConflictError` | `conflict` | 409 |
| `RateLimitError` | `rate_limited` | 429 |
| `InternalError` | `internal_error` | 500 |

Domain errors extend a base class and add a stable code, for example `ContentNotPlayableError extends ConflictError` with code `content_not_playable`.

### 7.2 Rules

- Services throw typed errors; they never return HTTP responses or status codes.
- `platform/http` maps errors to REST responses once. `app` maps them to `ActionResult` once.
- Expected domain errors are logged at `warn`/`info` with context; unexpected errors are logged at `error` with a stack trace and wrapped as `InternalError`.
- Preserve the original cause for logs; never send it to clients.
- No thrown strings, no `Promise.reject("...")`.
- Validate at every service boundary, even if the caller validated.
- Error boundaries: `app/global-error.tsx`, route-group `error.tsx`, and `not-found.tsx` provide safe user-facing states.
- A failed operation must never remain indefinitely loading; show an error and a retry/next action.

---

## 8. Logging

### 8.1 Format

- Pino structured JSON, one line per event.
- Required fields: `time`, `level`, `msg`, `requestId`, `module`, and either `event` or `action`.
- Useful optional fields: `userId` (opaque ID only), `route`, `method`, `status`, `durationMs`, `outcome`, `entityId`, `errorCode`.
- Do not log request bodies by default. Validation logs record field names, not sensitive values.
- Never log passwords, OAuth tokens, cookies, session secrets, authorization headers, API keys, or full video/subtitle URLs with query strings.

### 8.2 Levels

| Level | Use |
|---|---|
| `fatal` | Process cannot continue |
| `error` | Unexpected failure requiring attention |
| `warn` | Expected but noteworthy failure (rate limit, validation spike, delivery failure) |
| `info` | Request completion, state changes, maintenance results |
| `debug` | Development diagnostics |
| `trace` | Rare deep diagnostics; not enabled in production by default |

- Production default: `info`. Development default: `debug`. Override with `LOG_LEVEL`.
- Log one request-completion line per request, not one per database query.
- Do not log per playback second. Playback analytics are bounded database writes, not log spam.

### 8.3 Redaction and Correlation

- Pino redaction covers `req.headers.authorization`, `req.headers.cookie`, `password`, `token`, `secret`, `apiKey`, `clientSecret`, and `set-cookie`.
- `requestId` is generated at the edge/middleware, returned as `X-Request-Id`, and passed explicitly to services.
- Services accept a logging context; they do not create ad-hoc loggers.
- Logs are suitable for journald. No external log service is introduced.
- Error monitoring records are written by `app`-level error boundaries to `maintenance.recordError`, with safe metadata and a 30-day default retention.

---

## 9. Testing

### 9.1 Tools and Layout

- **Vitest** for unit and integration tests.
- **Playwright** for browser end-to-end tests.
- `tests/unit/` mirrors `src/` and tests pure logic, validation, authorization decisions, and mappings.
- `tests/integration/` tests repositories, transactions, and services against a real PostgreSQL test database.
- `tests/e2e/` tests critical user and admin flows against a running application.
- `tests/fixtures/` holds factories and seed helpers.

### 9.2 Test Database Isolation

- Tests use `TEST_DATABASE_URL`, never `DATABASE_URL`.
- The test database name must end with `_test`; startup fails otherwise.
- Migrations are applied to the test database before the suite.
- Prefer wrapping each test in a rolled-back transaction. Use truncation between tests when multiple connections or committed data are required.
- Tests must never point at production or a shared development database.
- Playwright uses a dedicated test database and a seeded application instance.

### 9.3 What to Test

| Layer | Required Coverage |
|---|---|
| Domain rules | Publication rules, availability, hierarchy, conversion, source replacement, completion threshold |
| Authorization | Every permission key, ownership checks, last-Super-Admin invariant, deactivated accounts |
| Validation | Zod boundaries, malformed input, URL/slug/image/CSV validation |
| Transactions | Publish with notifications, source replacement, permanent deletion, moves, conversions |
| Repositories | Critical queries, pagination, uniqueness, soft-delete filtering |
| API | Status codes, envelopes, error codes, pagination meta, authorization parity with actions |
| UI/E2E | Sign-in, browse, playback, bookmark, review, admin publish, moderation |

### 9.4 Rules

- Unit tests do not hit the network or database. Integration tests may hit the test database only.
- Mock external providers at the adapter boundary (Google OAuth, push delivery, filesystem where needed). Do not mock the module under test.
- Inject a clock for time-dependent rules (six-hour view window, completion threshold, retention).
- No random fake content in production. Factories are test-only.
- Test names describe behavior: `describe("content.publishEpisode")`, `it("rejects an episode without a source URL")`.
- Coverage is not a vanity gate. Critical domain and authorization paths must be covered.
- CI runs typecheck, lint, unit tests, integration tests, and production build. E2E runs on pull requests or a scheduled job once the application exists.

---

## 10. Migration Practices

### 10.1 Tooling and Files

- Drizzle Kit generates SQL migrations into `drizzle/`.
- Migration files are numbered sequentially: `0001_create_auth_tables.sql`, `0002_create_content_tables.sql`.
- Never edit an applied migration. Create a new migration.
- Migrations are reviewed like code and committed with the schema change.
- `drizzle-kit push` is forbidden in production. Production uses versioned migrations only.

### 10.2 Expand-Contract

Use expand-contract for changes that could break the previous application release:

1. **Expand:** add nullable columns, new tables, or new indexes without removing or renaming anything.
2. **Migrate:** backfill data in bounded, idempotent batches.
3. **Switch:** deploy application code that reads/writes the new shape.
4. **Contract:** remove the old column/table in a later release, after the previous release is no longer running.

A single release must not both add and remove a column that the previous release still uses.

### 10.3 Safety Rules

- Every migration states whether it is reversible or forward-fix-only. Drizzle Kit does not generate down migrations by default; document the rollback plan in the PR.
- Destructive changes (drop table/column, type narrowing, data deletion) require a backup and explicit confirmation before production execution.
- Data migrations are separate from schema migrations and are idempotent.
- Migrations run as a dedicated migration role with DDL rights; the application role has DML rights only.
- The application must not auto-run migrations at startup in production.
- Test migrations against a production-like database and verify with `drizzle-kit generate`/`check` that the schema matches.
- Seed only reference data (roles, permissions, default settings) with idempotent seeds. Never seed fake content, ratings, or views.
- A migration that cannot be applied safely must stop the release; do not rely on automatic schema synchronization.

---

## 11. Git and Review Conventions

- Use Conventional Commits: `feat(scope):`, `fix(scope):`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`, `build:`, `ci:`.
- Scope is the module or area: `content`, `auth`, `playback`, `admin`, `db`, `docs`.
- One logical change per commit. Prompt work is committed separately.
- Branches: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>`.
- A pull request states: prompt number, summary, changed files, tests run, migrations, security impact, and screenshots for UI changes.
- Never commit secrets, `.env.local`, uploaded images, backups, build output, or generated artifacts that are ignored.
- Preserve existing behavior and data unless the prompt explicitly changes them.
- Review against `ARCHITECTURE.md` boundaries and this document before merging.

---

## 12. Documentation and Progress Tracking

### 12.1 Document Responsibilities

| Document | Responsibility |
|---|---|
| `AGENTS.md` | Authoritative specification pack |
| `REQUIREMENTS.md` | Approved product scope |
| `ARCHITECTURE.md` | Layers, modules, dependencies, entrypoints, data ownership |
| `CONVENTIONS.md` | Day-to-day coding, data, API, testing, and migration rules |
| `DATABASE.md` | Schema, relationships, indexes, migration notes |
| `API.md` | REST and Server Action contracts |
| `SECURITY.md` | Security decisions and known limitations |
| `DECISIONS.md` | Approved decisions and supersessions |
| `CHANGELOG.md` | Notable changes by date |
| `PROJECT_STATUS.md` | Single source of truth for progress |

Do not duplicate content across documents. Link to the owning document instead.

### 12.2 `PROJECT_STATUS.md` Format

Maintain:

1. **Header** — current prompt, status, date.
2. **Repository baseline** — current state, documents, environment.
3. **Architectural conflicts** — none or explicit.
4. **Inputs required** — operational inputs, not product decisions.
5. **Prompt progress log** — one row per prompt:
   - Prompt number
   - Title
   - Status (`✅ Completed`, `🚧 In progress`, `⏸ Blocked`, `❌ Failed`, `⏭ Deferred`)
   - Changed files
   - Tests (command and result, or `N/A` with reason)
   - Notes / unresolved issues
6. **Next task** — the next prompt, explicitly not started.

Every prompt completion updates this file. A prompt is not complete until its row and the next task are accurate.

### 12.3 `CHANGELOG.md` Format

- Keep a Changelog style with an `Unreleased` section.
- Group by `Added`, `Changed`, `Fixed`, `Removed`, `Security`.
- One line per notable change, with the prompt number.
- Do not list every file; link to the prompt row in `PROJECT_STATUS.md`.

### 12.4 `DECISIONS.md` Rules

- Record a decision only after explicit approval or when the specification establishes it.
- Each entry states context, the decision, and consequences.
- Superseding a decision creates a new entry; old entries are never deleted.
- Implementation must not silently contradict an active decision.

---

## 13. Definition of Done

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

---

## 14. Tooling and Commands

| Command | Purpose | Established in |
|---|---|---|
| `npm run dev` | Start the development server | Prompt 006 |
| `npm run build` | Production build | Prompt 006 |
| `npm run start` | Start the production server | Prompt 006 |
| `npm run typecheck` | TypeScript check (`next typegen` + `tsc --noEmit`) | Prompt 007 |
| `npm run lint` | ESLint, including architecture rules | Prompt 013 |
| `npm run format` | Prettier write | Prompt 013 |
| `npm run format:check` | Prettier check | Prompt 013 |
| `npm run test` | Vitest unit tests | Prompt 017 |
| `npm run test:integration` | Vitest integration tests | Prompt 017 |
| `npm run test:e2e` | Playwright tests | Prompt 017 |
| `npm run db:generate` | Generate a Drizzle migration | Prompt 021 |
| `npm run db:migrate` | Apply migrations | Prompt 021 |
| `npm run db:seed` | Seed reference data | Prompt 021+ |
| `npm run maintenance -- <task>` | Run a maintenance command | Maintenance phase |

- Node.js 24 LTS is the runtime; pin it in `.nvmrc` and `package.json#engines`.
- `next-env.d.ts` is generated by Next.js and ignored; run `next typegen` before type checking in a clean checkout.
- npm is the current default package manager because it is available; the choice is confirmed in Prompt 006 and the lockfile is committed.
- Formatting: 2 spaces, single quotes, semicolons, trailing commas `all`, print width 100, LF line endings, UTF-8.
- Do not add a dependency without a clear need, a license check, and an update to the relevant document.

---

## 15. Exceptions

Any exception to these conventions requires:

1. a written explanation in the pull request,
2. approval from the project owner,
3. a `DECISIONS.md` entry when the exception is durable,
4. an update to this document if the exception changes the rule.

Convenience is not a reason to bypass authorization, validation, transactions, or module boundaries.