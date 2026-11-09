# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added
- **Prompt 016:** Configure Pino Structured Logging
  - Added `pino` as a production dependency
  - Created `src/platform/logging.ts` with structured JSON logger
  - Configured redaction for sensitive fields (`authorization`, `cookie`, `password`, `token`, `secret`, `apiKey`, `clientSecret`, `set-cookie`)
  - Set log level defaults: `info` production, `debug` development, overridable via `LOG_LEVEL` env var
  - Created `ServiceContext` type for service-level logging context
  - Added `generateRequestId()` and `createRequestLogger()` exports
  - Created `src/platform/middleware/request-id.ts` with `withRequestId` HOC and `addRequestIdHeader` helper
  - Added `LOG_LEVEL` to `.env.example` and config schema
  - Request ID format: `01J-<11 uppercase alphanumeric chars>`, added to `X-Request-Id` response header
- **Prompt 017:** Establish Testing Foundation
  - Added `vitest`, `@vitest/coverage-v8`, `supertest`, and `@playwright/test` as dev dependencies
  - Created `vitest.config.ts` with unit, integration, and E2E test patterns
  - Created `tests/global-setup.ts` for test database setup (database creation, migration application)
  - Created `tests/global-teardown.ts` for test suite teardown
  - Added test scripts: `test`, `test:watch`, `test:integration`, `test:e2e`, `db:push`
  - Set up `TEST_DATABASE_URL` in `.env.example` with `_test` database naming convention
  - Established test directory structure: `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/fixtures/`
  - Installed Playwright browsers (Chrome, Firefox, WebKit)
- **Prompt 018:** Establish CI Quality Checks
  - Added `.github/workflows/ci.yml` with typecheck, lint, unit-test, integration-test,
    and production-build jobs on pushes to `main`, pull requests, and manual dispatch
  - Integration tests run against an isolated PostgreSQL 18 service using
    `TEST_DATABASE_URL`; CI uses read-only repository permissions
  - Added `docs/development/ci-cd.md` documenting the quality gate, deterministic
    installation, local reproduction, and the manual production-approval policy
  - Added `vitest.integration.config.ts` so integration tests own their database setup
  - Added `dotenv` as an explicit dev dependency for test environment loading

### Changed
- Updated `src/platform/config/schema.ts` to include optional `LOG_LEVEL` field
- **Prompt 018:** `npm test` now runs unit tests only; `npm run test:integration` uses
  `vitest.integration.config.ts` and reads `TEST_DATABASE_URL` from the environment
- **Prompt 018:** `tests/global-setup.ts` preserves database credentials, rejects test
  database names that do not end in `_test`, parameterizes the existence check, and
  skips Drizzle migrations until `drizzle.config.ts` exists
- **Prompt 018:** Aligned ESLint plugin versions with ESLint 9 and added `vite` (required
  by Vitest 5), so a plain `npm ci` resolves and installs cleanly

### Deprecated
- None

### Removed
- None

### Fixed
- **Prompt 018:** Added `override` modifiers required by `noImplicitOverride` in the
  platform error hierarchy, resolving pre-existing type-check failures
- **Prompt 018:** Resolved pre-existing lint failures (missing final newlines,
  unnecessary parentheses, unused parameter names)
- **Prompt 018:** Replaced Tailwind v4-only spacing syntax in `card.tsx` with Tailwind v3
  arbitrary values, resolving the pre-existing production-build CSS failure

### Security
- None