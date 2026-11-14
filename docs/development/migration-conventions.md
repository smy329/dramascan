# Migration Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08

This document defines the migration practices, derived from `CONVENTIONS.md` §10 and established by Prompt 004. It covers tooling, expand-contract, safety rules, and the change process. Prompt 021 configures the drizzle-kit migration infrastructure.

**Completion:** Drizzle-kit is installed and configured; `db:generate` and `db:migrate` scripts are functional.

---

## 1. Tooling and Files

- Drizzle Kit generates SQL migrations into `drizzle/`.
- Migration files are numbered sequentially: `0001_create_auth_tables.sql`, `0002_create_content_tables.sql`.
- Never edit an applied migration. Create a new migration.
- Migrations are reviewed like code and committed with the schema change.
- `drizzle-kit push` is forbidden in production. Production uses versioned migrations only.

**Prompt 021:** Drizzle-kit installed and configured via `drizzle.config.ts`. `db:generate` generates migration skeleton into `drizzle/`. `db:migrate` applies migrations against the connected PostgreSQL database. Initial run with no tables produced no schema changes (expected; data models begin in Prompt 022).

---

## 2. Expand-Contract

Use expand-contract for changes that could break the previous application release:

1. **Expand:** add nullable columns, new tables, or new indexes without removing or renaming anything.
2. **Migrate:** backfill data in bounded, idempotent batches.
3. **Switch:** deploy application code that reads/writes the new shape.
4. **Contract:** remove the old column/table in a later release, after the previous release is no longer running.

A single release must not both add and remove a column that the previous release still uses.

---

## 3. Safety Rules

- Every migration states whether it is reversible or forward-fix-only. Drizzle Kit does not generate down migrations by default; document the rollback plan in the PR.
- Destructive changes (drop table/column, type narrowing, data deletion) require a backup and explicit confirmation before production execution.
- Data migrations are separate from schema migrations and are idempotent.
- `drizzle-kit` is invoked through `drizzle.config.ts`, which loads `.env.local`
  when present. Real environment variables always win, so CI and production
  supply `DATABASE_URL` directly. Run `npm run db:migrate` after pulling schema
  changes; a dev database that lags the code produces `column ... does not
  exist` errors at runtime.
- Migrations run as a dedicated migration role with DDL rights; the application role has DML rights only.
- The application must not auto-run migrations at startup in production.
- Test migrations against a production-like database and verify with `drizzle-kit generate`/`check` that the schema matches.
- Seed only reference data (roles, permissions, default settings) with idempotent seeds. Never seed fake content, ratings, or views.
- A migration that cannot be applied safely must stop the release; do not rely on automatic schema synchronization.

---

## 4. Change Process

1. Read `CONVENTIONS.md` §10 and this document.
2. Confirm the table belongs to the module making the change.
3. Update the module's `schema.ts` and add a migration.
4. Update the table catalog.
5. Update this document's relationship/index notes.
6. Run typecheck, integration tests, and migration checks.
7. Record a decision if ownership, identity strategy, or a destructive change is involved.
8. Update `PROJECT_STATUS.md`.

Do not modify another module's table. Do not add a cross-module write to avoid a workflow.
