# Testing Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08

This document defines the testing conventions, derived from `CONVENTIONS.md` §9 and established by Prompt 004. It covers tools, layout, isolation, coverage, and rules.

---

## 1. Tools and Layout

- **Vitest** for unit and integration tests.
- **Playwright** for browser end-to-end tests.

### 1.1 Test Layout

| Directory            | Purpose                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| `tests/unit/`        | Mirrors `src/` and tests pure logic, validation, authorization decisions, and mappings. |
| `tests/integration/` | Tests repositories, transactions, and services against a real PostgreSQL test database. |
| `tests/e2e/`         | Tests critical user and admin flows against a running application.                      |
| `tests/fixtures/`    | Holds factories and seed helpers.                                                       |

### 1.2 Component Tests

- Presentational component tests live under `tests/unit/components/` and use the `.test.tsx` suffix.
- Vitest keeps `node` as its default environment. A component test opts into jsdom with `// @vitest-environment jsdom` as its first line, so existing unit and integration behavior is unchanged.
- Component tests use React Testing Library and assert user-observable behavior: roles, accessible names, visible text, links, and fallback states. Avoid internal state or implementation-detail assertions.
- Call `cleanup` in `afterEach`.
- Simulate image loading failures with `fireEvent.error`; jsdom does not load images from the network.
- Name the file after the component under test, for example `content-card.test.tsx`.

---

## 2. Test Database Isolation

- Tests use `TEST_DATABASE_URL`, never `DATABASE_URL`.
- The test database name must end with `_test`; startup fails otherwise.
- Migrations are applied to the test database before the suite.
- Prefer wrapping each test in a rolled-back transaction. Use truncation between tests when multiple connections or committed data are required.
- Tests must never point at production or a shared development database.
- Playwright uses a dedicated test database and a seeded application instance.

---

## 3. What to Test

| Layer         | Required Coverage                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Domain rules  | Publication rules, availability, hierarchy, conversion, source replacement, completion threshold |
| Authorization | Every permission key, ownership checks, last-Super-Admin invariant, deactivated accounts         |
| Validation    | Zod boundaries, malformed input, URL/slug/image/CSV validation                                   |
| Transactions  | Publish with notifications, source replacement, permanent deletion, moves, conversions           |
| Repositories  | Critical queries, pagination, uniqueness, soft-delete filtering                                  |
| API           | Status codes, envelopes, error codes, pagination meta, authorization parity with actions         |
| UI/E2E        | Sign-in, browse, playback, bookmark, review, admin publish, moderation                           |

---

## 4. Testing Rules

- Unit tests do not hit the network or database. Integration tests may hit the test database only.
- Mock external providers at the adapter boundary (Google OAuth, push delivery, filesystem where needed). Do not mock the module under test.
- Inject a clock for time-dependent rules (six-hour view window, completion threshold, retention).
- No random fake content in production. Factories are test-only.
- Test names describe behavior: `describe("content.publishEpisode")`, `it("rejects an episode without a source URL")`.
- Coverage is not a vanity gate. Critical domain and authorization paths must be covered.
- CI runs typecheck, lint, unit tests, integration tests, and a production build. E2E runs on pull requests or a scheduled job once the application exists.

---

## 5. Factory and Seed Conventions

- Factories and seed helpers are test-only and must not appear in production.
- Seed only reference data (roles, permissions, default settings) with idempotent seeds.
- Never seed fake content, ratings, or view counts.
- Factories should generate valid records respecting all constraints (UUIDv7, snake_case, timestamptz, partial unique indexes).

---
