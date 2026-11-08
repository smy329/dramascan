# Non-Functional Requirements

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08

This document captures the non-functional requirements from REQUIREMENTS.md §15, organized by category. It is the authoritative reference for how the system should behave beyond functional behavior.

---

## 1. Architecture and Code Quality

### 1.1 Modular Monolith

- The initial implementation must remain a **lightweight modular monolith**.
- One Next.js process, one PostgreSQL database; no service split.
- No Docker, no Redis, no persistent workers, no job queue, no separate worker service.

### 1.2 Modular Boundaries

- Each module owns its tables and exposes exactly one public `index.ts`.
- Upward imports and unlisted same-layer imports are forbidden (enforced by ESLint boundaries, `import/no-cycle`, TypeScript strict mode, and CI).
- Only four same-layer edges are permitted: `users → content`, `playback → content`, `reviews → content`, `administration → maintenance`.

### 1.3 TypeScript Strictness

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`.
- `noUnusedLocals: true`, `noUnusedParameters: true`, `forceConsistentCasingInFileNames: true`.
- `moduleResolution: "bundler"`, `target: "ES2022"`, `jsx: "react-jsx"` (Next.js 16 automatic runtime).
- `incremental: true`, `skipLibCheck: true` (application code is still fully checked).
- No ignored type errors. `@ts-ignore` is forbidden. `@ts-expect-error` requires a comment explaining why.

### 1.4 Domain Logic Separation

- Keep domain logic separate from UI components.
- Server-side authorization is the security authority; hiding UI is never sufficient.
- Validate all untrusted input on the server.

---

## 2. Performance and Resource Use

### 2.1 Low-RAM Production

- Keep the production architecture resource-efficient and suitable for a low-RAM server.
- Use server-side pagination for large datasets; never load entire user, review, or content collections into browser memory.
- Use bounded queries, appropriate indexes, and efficient list queries.
- Avoid expensive full-catalog queries.
- Avoid writing to PostgreSQL on every playback second.
- Avoid excessive polling and long-running connections.
- Use conservative database connection limits, timeouts, and safe reconnection.
- Use caching and compression without leaking private or unpublished data.

### 2.2 Maintenance Efficiency

- Keep maintenance and analytics work bounded and non-blocking to normal viewing.
- Short-lived systemd maintenance commands only; no persistent workers or queue.

---

## 3. Reliability and Data Integrity

### 3.1 Transactions

- Use transactions for critical multi-record changes, including conversions, moves, source replacement, publication, and deletion cleanup.
- Handle failures explicitly and return safe user-facing errors.
- Preserve stable IDs and relationships across edits, reordering, moves, and conversions.
- Preserve watch history dates across progress resets and source replacement.
- Protect the last known-good backup.

### 3.2 Data Integrity

- Use expand-contract for breaking database schema changes.
- Destructive migrations require a backup, explicit confirmation, and a documented rollback or forward-fix plan.
- The application must not auto-run migrations at startup in production.
- Test migrations against a production-like database and verify with `drizzle-kit generate`/`check` that the schema matches.

---

## 4. UI, Responsiveness, and Accessibility

### 4.1 Visual Design

- Dark-only interface; do not implement a light-theme switching system.
- Cinematic, modern public design; separate admin workspace.
- Consistent global visual foundation: container widths, page spacing, typography hierarchy, surface colors, focus states, and responsive behavior.

### 4.2 UI Components

- Reusable, accessible UI components with consistent variants for buttons, inputs, dialogs, dropdowns, tabs, tables, cards, tooltips, and notifications.
- Install only the shadcn/ui components needed by the initial application.

### 4.3 Responsiveness

- Responsive desktop and mobile layouts.
- Navigation must not overlap the player, dialogs, or mobile safe areas.
- Player controls must have clear labels, adequate touch targets, keyboard accessibility where supported, and readable error messages.

### 4.4 Accessibility

- Do not introduce a separate site-wide keyboard-navigation feature; implement only the accessibility necessary for the player and controls.

---

## 5. Time and Locale

- Store timestamps consistently in UTC.
- Use an injectable clock where time matters (domain logic).

---

## 6. Testing and CI

### 6.1 Test Tools

- **Vitest** for unit and integration tests.
- **Playwright** for browser end-to-end tests.

### 6.2 Test Layout

- `tests/unit/` mirrors `src/` and tests pure logic, validation, authorization decisions, and mappings.
- `tests/integration/` tests repositories, transactions, and services against a real PostgreSQL test database.
- `tests/e2e/` tests critical user and admin flows against a running application.
- `tests/fixtures/` holds factories and seed helpers.

### 6.3 Test Isolation

- Tests use `TEST_DATABASE_URL`, never `DATABASE_URL`.
- The test database name must end with `_test`; startup fails otherwise.
- Migrations are applied to the test database before the suite.
- Prefer wrapping each test in a rolled-back transaction. Use truncation between tests when multiple connections or committed data are required.
- Tests must never point at production or a shared development database.
- Playwright uses a dedicated test database and a seeded application instance.

### 6.4 Test Coverage

- **Domain rules:** Publication rules, availability, hierarchy, conversion, source replacement, completion threshold.
- **Authorization:** Every permission key, ownership checks, last-Super-Admin invariant, deactivated accounts.
- **Validation:** Zod boundaries, malformed input, URL/slug/image/CSV validation.
- **Transactions:** Publish with notifications, source replacement, permanent deletion, moves, conversions.
- **Repositories:** Critical queries, pagination, uniqueness, soft-delete filtering.
- **API:** Status codes, envelopes, error codes, pagination meta, authorization parity with actions.
- **UI/E2E:** Sign-in, browse, playback, bookmark, review, admin publish, moderation.

### 6.5 Testing Rules

- Unit tests do not hit the network or database. Integration tests may hit the test database only.
- Mock external providers at the adapter boundary (Google OAuth, push delivery, filesystem where needed). Do not mock the module under test.
- Inject a clock for time-dependent rules (six-hour view window, completion threshold, retention).
- No random fake content in production. Factories are test-only.
- Test names describe behavior: `describe("content.publishEpisode")`, `it("rejects an episode without a source URL")`.
- Coverage is not a vanity gate. Critical domain and authorization paths must be covered.
- CI runs typecheck, lint, unit tests, integration tests, and a production build. E2E runs on pull requests or a scheduled job once the application exists.

---

## 7. Logging and Error Handling

### 7.1 Logging Format

- Pino structured JSON, one line per event.
- Required fields: `time`, `level`, `msg`, `requestId`, `module`, and either `event` or `action`.
- Useful optional fields: `userId` (opaque ID only), `route`, `method`, `status`, `durationMs`, `outcome`, `entityId`, `errorCode`.
- Do not log request bodies by default. Validation logs record field names, not sensitive values.
- Never log passwords, OAuth tokens, cookies, session secrets, authorization headers, API keys, or full video/subtitle URLs with query strings.

### 7.2 Log Levels

| Level   | Use                                                                              |
| ------- | -------------------------------------------------------------------------------- |
| `fatal` | Process cannot continue                                                          |
| `error` | Unexpected failure requiring attention                                           |
| `warn`  | Expected but noteworthy failure (rate limit, validation spike, delivery failure) |
| `info`  | Request completion, state changes, maintenance results                           |
| `debug` | Development diagnostics                                                          |
| `trace` | Rare deep diagnostics; not enabled in production by default                      |

- Production default: `info`. Development default: `debug`. Override with `LOG_LEVEL`.
- Log one request-completion line per request, not one per database query.
- Do not log per playback second. Playback analytics are bounded database writes, not log spam.

### 7.3 Error Handling

- Services throw typed errors. They never return HTTP responses or status codes.
- `platform/http` maps errors to REST responses once; `app` maps them to `ActionResult` once.
- Expected domain failures are logged at `warn`/`info`; unexpected failures are logged at `error` with a stack trace and wrapped as `InternalError`.
- Preserve the original cause for logs; never send it to clients.
- No thrown strings, no `Promise.reject("...")`.
- Validate at every service boundary, even if the caller validated.
- Error boundaries: `app/global-error.tsx`, route-group `error.tsx`, and `not-found.tsx` provide safe user-facing states.
- A failed operation must never remain indefinitely loading; show an error and a retry/next action.

---

## 8. API Conventions

- JSON fields are camelCase; database columns remain snake_case and are mapped in DTOs.
- IDs are strings (UUIDv7 for application entities).
- Timestamps are ISO 8601 UTC strings with milliseconds.
- Enum values are lowercase snake_case strings.
- Successful single-resource responses are `{ data }`; collections are `{ data, meta }` with pagination meta.
- Page-based pagination defaults to `page=1`, `pageSize=20`, maximum `100`.
- Errors use `{ error: { code, message, fieldErrors?, requestId } }` with stable snake_case codes.
- Public unavailable content returns `404`, never `403`.
- REST and Server Action authorization must match.
- Rate-limited endpoints return `429` with `Retry-After`; rate limiting is PostgreSQL-backed, not Redis.

---

## 9. Documentation and Progress Tracking

- Documentation is split by responsibility: `REQUIREMENTS.md` (scope), `ARCHITECTURE.md` (boundaries), `CONVENTIONS.md` (day-to-day rules), `DATABASE.md` (schema), `API.md` (contracts), `SECURITY.md` (controls and limitations), `DECISIONS.md` (approved choices), `CHANGELOG.md` (notable changes), and `PROJECT_STATUS.md` (single source of progress truth).
- Before changing code, an agent reads `PROJECT_STATUS.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, and the relevant area document, then inspects the module's `index.ts` and tests.
- `PROJECT_STATUS.md` uses one row per prompt with prompt number, title, status, changed files, tests, and notes/unresolved issues, plus a next-task section.
- A prompt is not complete until its status row, the next task, and applicable changelog or decision entries are accurate.
- Documents link to the owning document instead of duplicating content.
- Unverified behavior and known limitations are reported in the status row.

---

**Cross-reference:** This document consolidates REQUIREMENTS.md §15. The authoritative source remains REQUIREMENTS.md. For scope boundaries, see §16.
