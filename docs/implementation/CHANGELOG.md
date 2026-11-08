# CHANGELOG

**Project:** DramaScan — International Drama & Movie Streaming Platform

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project does not yet have
released versions; changes accumulate under `Unreleased` until the first release.

Entry conventions are defined in `CONVENTIONS.md` §12.3. Each line names the prompt that
introduced the change. Per-file detail lives in the prompt row in `PROJECT_STATUS.md`;
this file records notable outcomes, not every edit.

---

## [Unreleased]

### Added

- **Prompt 001:** Repository baseline inspection and initial `PROJECT_STATUS.md`, recording
  the greenfield state, local toolchain, and pending operational inputs.
- **Prompt 002:** `REQUIREMENTS.md` defining approved product scope, hard exclusions, and
  future backlog boundaries; `DECISIONS.md` established with product decisions D-000–D-007.
- **Prompt 003:** `ARCHITECTURE.md` defining the modular monolith: 11 feature modules, the
  `src/workflows/` orchestration layer, the acyclic dependency matrix, entrypoint
  allocation, data ownership, transaction coordination, and enforcement rules; decisions
  D-008–D-012.
- **Prompt 004:** `CONVENTIONS.md` defining naming, directory, TypeScript, database, API,
  error, logging, testing, migration, Git, and definition-of-done conventions.
- **Prompt 004:** `DATABASE.md` documenting database conventions, the planned ownership
  map, relationship integrity rules, index strategy, migration practices, and the table
  catalog placeholder.
- **Prompt 004:** `API.md` documenting the success/error envelopes, pagination, sorting,
  filtering, authentication, CSRF, caching, rate limiting, the planned REST endpoint
  catalog, the Server Action catalog, and the endpoint documentation template.
- **Prompt 004:** `SECURITY.md` documenting security principles, planned controls, the
  authorization model, external media URL risks, database and backup security, and
  explicitly accepted limitations.
- **Prompt 004:** `CHANGELOG.md` (this file).
- **Prompt 004:** Decisions D-013–D-017 recording database identity/naming, API response
  and pagination, testing and migrations, documentation/progress tracking, and
  error/logging conventions.
- **Prompt 006:** Minimal Next.js 16.4.5 App Router application with TypeScript, React
  19.3.1, npm lockfile, `dev`/`build`/`start` scripts, Node 24 engine pinning, a root
  layout, branded home route, and dark global styles. Decision D-018 records the runtime
  and package-manager baseline.

### Changed

- **Prompt 003:** `PROJECT_STATUS.md` updated to record the approved architecture and the
  next task.
- **Prompt 004:** `PROJECT_STATUS.md` updated with the Prompt 004 row, the expanded
  documentation set, and the next task.
- **Prompt 006:** `README.md` now documents installation and the development/production
  scripts; progress documents and TypeScript conventions reflect the initialized
  application and Next.js 16's required `react-jsx` mode.

### Fixed

- **Prompt 004:** Corrected a self-referential instruction in `DATABASE.md` §9 so the
  change process says to update "this document's relationship/index notes."

### Removed

- Nothing removed.

### Security

- **Prompt 004:** Established security documentation requirements: server-side
  authorization as the sole authority, deny-by-default behavior, no secret exposure in
  logs/exports/errors, no server-side fetching of arbitrary administrator media URLs, and
  fail-closed rate limiting for sensitive operations. No control is implemented yet.

---

## Release History

No releases yet. The first release entry is added when a deployable application exists.
