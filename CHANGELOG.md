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