# CI/CD Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-09  
**Established by:** Prompt 018

This document describes the GitHub Actions quality gate, deterministic dependency
installation, and the production deployment approval policy. The mandatory checks are
defined in `REQUIREMENTS.md` §14.6 and §15.6 and `CONVENTIONS.md` §9.

---

## 1. Continuous Integration

Workflow: `.github/workflows/ci.yml`

### 1.1 Triggers

- Push to `main`.
- Every pull request.
- Manual dispatch (`workflow_dispatch`).

Superseded runs on the same branch or pull request are cancelled.

### 1.2 Jobs

| Job           | Steps                                                               |
| ------------- | ------------------------------------------------------------------- |
| `quality`     | Install, type check, lint, unit tests, production build             |
| `integration` | Install, start an isolated PostgreSQL 18 service, integration tests |

The build step validates that the application compiles for production. Build artifacts
are created inside the CI runner; deployment artifact packaging is added with the
deployment workflow in a later prompt.

### 1.3 Commands

| Check             | Command                    |
| ----------------- | -------------------------- |
| Type check        | `npm run typecheck`        |
| Lint              | `npm run lint`             |
| Unit tests        | `npm test`                 |
| Integration tests | `npm run test:integration` |
| Production build  | `npm run build`            |

Unit tests must not touch a database. Integration tests use
`vitest.integration.config.ts` and the isolated PostgreSQL service configured through
`TEST_DATABASE_URL`; the database name must end in `_test`.

`tests/global-setup.ts` skips Drizzle migrations until `drizzle.config.ts` exists. Once
the database prompts introduce migrations, integration runs apply them before the suite.

### 1.4 Deterministic installation and lockfile validation

- `npm ci` is mandatory in CI. It installs exactly from `package-lock.json` and fails if
  `package.json` and the lockfile disagree.
- `package-lock.json` is committed and must be updated in the same change as
  `package.json`.
- The Node.js version comes from `.nvmrc` (Node 24 LTS); `package.json` also declares
  `engines.node >= 24.0.0`.
- The npm download cache is keyed by `package-lock.json`.

### 1.5 Test suites during the foundation phase

Prompt 017 established the test infrastructure but did not add test files. Until the
first unit and integration suites are committed, CI runs Vitest with
`--passWithNoTests` so the pipeline validates its configuration without failing on an
empty suite. The flag should be removed once stable test suites exist.

End-to-end Playwright tests are not part of this workflow yet. Per `CONVENTIONS.md` §9,
they run on pull requests or a scheduled job once application flows exist.

### 1.6 Required checks

Configure the `quality` and `integration` jobs as required status checks on `main` so a
pull request cannot merge while type checking, linting, tests, or the production build
fail.

---

## 2. Continuous Deployment

No deployment workflow is enabled in Prompt 018. Pushes and pull requests never deploy.

When production deployment is implemented, it must:

1. Run only through `workflow_dispatch` after the `quality` and `integration` jobs pass.
2. Target a protected GitHub Environment named `production` with required reviewers, so a
   human explicitly approves each deployment.
3. Consume artifacts built by CI rather than building on the production VPS.
4. Use versioned releases with a documented rollback path.
5. Apply versioned migrations only; never use `drizzle-kit push` or automatic schema
   synchronization in production.

Blind automatic deployment on push is forbidden.

---

## 3. Local Reproduction

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Integration tests require a local PostgreSQL database and `TEST_DATABASE_URL`:

```bash
# PowerShell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@localhost:5432/dramascan_test'
npm run test:integration
```

```bash
# POSIX shells
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/dramascan_test' npm run test:integration
```

Never point `TEST_DATABASE_URL` at production or a shared development database.
