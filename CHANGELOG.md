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

### Changed
- Updated `src/platform/config/schema.ts` to include optional `LOG_LEVEL` field

### Changed
- Updated `src/platform/config/schema.ts` to include optional `LOG_LEVEL` field

### Deprecated
- None

### Removed
- None

### Fixed
- None

### Security
- None