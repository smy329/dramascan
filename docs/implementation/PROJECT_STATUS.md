# PROJECT STATUS

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Baseline date:** 2026-11-07
**Last updated:** 2026-11-08
**Current prompt:** 008 — Establish the Application Directory Structure
**Status:** Prompt 007 completed; Prompt 008 not started

---

## 1. Repository Baseline

| Item | Finding |
|---|---|
| Repository state | Greenfield baseline established in Prompt 001; application initialized in Prompt 006 |
| Project root | `D:\Source code\Opencode\DramaScan\DramaScan` |
| Git repository | **Initialized** on `main`; remote `origin` = `https://github.com/smy329/dramascan.git`; baseline commit `7ab51da` |
| Application framework | **Next.js 16.4.5** (App Router), React 19.3.1, TypeScript 5.9.3 |
| Package manager | **npm 11.12.1**; `package-lock.json` committed in the baseline |
| Scripts | `dev`, `build`, `start`, `typecheck` |
| Application source | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/lib/contracts/common.ts` |
| Configuration | `package.json`, `tsconfig.json` (strict flags), `next.config.ts`, `.nvmrc`, `.gitignore` |
| Environment configuration | None yet (Prompt 009) |
| Database schema | None; no ORM, migrations, or seed data yet |
| Existing UI | Minimal branded root route; no product UI yet |
| Partially implemented features | None |
| Existing user data | None |

The parent directory `D:\Source code\Opencode\DramaScan` contains only the specification
source documents (`Detailed MICRO-PROMPT DEVELOPMENT PACK.txt`,
`MASTER DEVELOPMENT PROMPT.txt`, `MICRO-PROMPT DEVELOPMENT PACK.txt`). These are
reference material, not part of the application.

Current repository documents and application files: `AGENTS.md`, `README.md`,
`package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `.nvmrc`,
`.gitignore`, `src/app/`, `src/lib/contracts/`, and the consolidated documentation under
`docs/`.

**Conclusion:** This remains a new project with no user data to preserve. The
application scaffold is in place and the next foundation prompts add strict TypeScript,
the directory structure, environment validation, and styling.

---

## 2. Local Development Environment

| Tool | Version / Status |
|---|---|
| OS | Windows (development host); production target Ubuntu 24.04 LTS |
| Node.js | v24.15.0 (`C:\Program Files\nodejs\node.exe`) |
| npm | 11.12.1 |
| Next.js | 16.4.5 (App Router, Turbopack build/dev pipeline) |
| React | 19.3.1 |
| TypeScript | 5.9.3 |
| pnpm | Not installed |
| yarn | Not installed |
| Git | 2.55.0 (windows.3) |
| PostgreSQL | **18.6 server installed and running** as service `postgresql-x64-18` on `localhost:5432` |
| `psql` | Installed at `C:\Program Files\PostgreSQL\18\bin\psql.exe`, but **not on `PATH`** |
| Docker | Not installed (consistent with the spec's no-Docker restriction) |
| Global npm packages | `@opencode/cli@2.2.3`, `node-sass@7.0.1`, `uipro-cli@2.2.3` |

### Database access limitation

The PostgreSQL server requires password authentication (`fe_sendauth: no password
supplied`). No `PGPASSWORD` or `DATABASE_URL` is defined in the environment, and no
credentials were supplied. Database creation, migration, and connectivity verification
cannot be performed until development credentials are provided.

---

## 3. Architectural Conflicts

**None.** The initialized application follows the approved modular monolith architecture.
`src/app/` currently contains only the root layout and route; module, workflow, platform,
database, and component directories are introduced by their assigned prompts.

---

## 4. Inputs and Environment Prerequisites

These are operational prerequisites, not unresolved product decisions.

### 4.1 PostgreSQL development credentials — pending

- The local PostgreSQL 18.6 server requires password authentication; no development
  credentials have been supplied.
- This is an environment setup prerequisite, not a code or product decision. The
  application foundation, type checks, and production build do not require a database
  connection.
- Do not invent credentials, document real values, or commit secrets. Real development
  values go only in `.env.local`, which is ignored.
- `.env.example` is intentionally absent until Prompt 009. Prompt 009 creates it with
  safe placeholders and explanatory comments only; it must never contain working
  credentials.
- Database-dependent work begins with the schema and migration prompts. Until then this
  prerequisite does not block database-free foundation work.

### 4.2 Type placement and module directories — decided

- `src/lib/contracts/` holds only cross-cutting, client-safe contracts shared across
  application areas, such as `ActionResult` and pagination metadata.
- Domain-specific types belong inside the owning module (`src/modules/<domain>/`) and are
  created when that module is implemented. They cross module boundaries only through the
  module's `index.ts`.
- Do not create speculative types or empty directories for unimplemented modules.

### 4.3 Resolved operational inputs

**Git resolved 2026-11-08:** the repository is initialized on `main` with the GitHub
remote `origin`; after Prompt 007, changes are committed and pushed per `AGENTS.md`.

**Package manager resolved 2026-11-08:** npm is confirmed for Prompt 006
(`package-lock.json` is committed). No further package-manager choice is pending.

**Runtime and framework baseline resolved 2026-11-08** (see `DECISIONS.md` D-018):

- Next.js 16.4.5 with the App Router.
- React 19.3.1.
- TypeScript 5.9.3, with strict compiler flags and a `next typegen`-backed `typecheck` script.
- Node.js 24 LTS, pinned in `.nvmrc` and `package.json#engines`.

**Product-scope decisions resolved 2026-11-08** (see `DECISIONS.md`):

1. Ratings and reviews are content-level for dramas and movies; episodes excluded.
2. View counting is content-level for dramas and movies with the six-hour rule.
3. Content reports require authentication.
4. Subtitles are supported for episodes and movies.
5. Account/security notifications cover the approved reliably detectable triggers.
6. Standalone movies are included in Watch History.
7. Movie canonical URL is `/movie/{stableId}/{slug}`.

No product-scope decisions remain open.

**Architecture decisions resolved 2026-11-08** (see `DECISIONS.md` D-008–D-012):

1. Modular monolith = feature modules over a shared platform layer plus a workflow layer.
2. Cross-module side effects are coordinated by `src/workflows/`; modules never import each other to trigger a side effect.
3. Server Components read via query services; Server Actions mutate; REST is limited to an explicit allowlist.
4. Each module owns its tables; cross-module JOINs only in approved read models.
5. Atomic cross-module operations share one explicit PostgreSQL transaction.

**Documentation and development conventions resolved 2026-11-08** (see `DECISIONS.md` D-013–D-017):

1. Application primary keys are UUIDv7; timestamps are `timestamptz`; tables/columns are
   `snake_case`; Trash is `deleted_at` with a separate publication status.
2. API responses use `{ data }` / `{ data, meta }` and errors use
   `{ error: { code, message, fieldErrors?, requestId } }`; pagination is page-based.
3. Tests use Vitest/Playwright with a `_test` database; migrations are sequential,
   reviewed, and expand-contract.
4. Documentation is split by responsibility; `PROJECT_STATUS.md` is the single progress
   source with one row per prompt.
5. Services throw typed errors; entrypoints map them once; logging is Pino JSON with
   redaction.

The development rulebook is `CONVENTIONS.md`. Future agents must read it and the relevant
area document before changing code.

---

## 5. Prompt Progress Log

| Prompt | Title | Status | Changed files | Tests | Notes |
|---|---|---|---|---|---|
| 001 | Inspect existing project and establish baseline | ✅ Completed | `PROJECT_STATUS.md` (new) | N/A (inspection only) | Greenfield; no conflicts; DB credentials pending |
| 002 | Establish the authoritative product requirements | ✅ Completed | `REQUIREMENTS.md` (new), `DECISIONS.md` (new), `PROJECT_STATUS.md` (updated) | N/A (documentation only) | Scope documented; hard exclusions and future backlog separated; 6 product decisions resolved 2026-11-08; movie URL fixed |
| 003 | Establish the modular monolith architecture | ✅ Completed | `ARCHITECTURE.md` (new), `DECISIONS.md` (D-008–D-012 added), `PROJECT_STATUS.md` (updated) | N/A (documentation only) | 11 modules + workflow layer; acyclic dependency matrix; entrypoint allocation; data ownership; transaction coordination; enforcement rules |
| 004 | Create project documentation and development conventions | ✅ Completed | `CONVENTIONS.md` (new), `DATABASE.md` (new; §9 instruction corrected), `API.md` (new), `SECURITY.md` (new), `CHANGELOG.md` (new), `DECISIONS.md` (D-013–D-017 added), `PROJECT_STATUS.md` (updated), `DATABASE.md` typo fix | N/A (documentation only); consistency checked against `REQUIREMENTS.md`, `ARCHITECTURE.md`, and active decisions | Naming/directory/TypeScript/database/API/error/logging/testing/migration rules; read-before-change process; prompt progress format; security principles and accepted limitations; no application code written |
| 005 | Define the initial scope and future upgrade backlog | ✅ Completed | `INITIAL_SCOPE_AND_FUTURE_BACKLOG.md` (new), `REQUIREMENTS.md` §16 updated, `PROJECT_STATUS.md` (updated) | N/A (documentation only); consistency checked against `REQUIREMENTS.md` and active decisions | Two clearly separated lists (initial scope / future upgrade backlog); scope enforcement rules |
| 006 | Initialize the Next.js application | ✅ Completed | `package.json` (new), `package-lock.json` (new), `tsconfig.json` (new), `next.config.ts` (new), `.nvmrc` (new), `.gitignore` (new), `src/app/layout.tsx` (new), `src/app/page.tsx` (new), `src/app/globals.css` (new), `README.md`, `CONVENTIONS.md`, `coding-conventions.md`, `DECISIONS.md`, `CHANGELOG.md`, `PROJECT_STATUS.md`, `progress-tracker.md`, `implementation-plan.md` | `npm install` (29 packages, 0 vulnerabilities); `npx tsc --noEmit` (passed); `npm run build` (passed, Next 16.4.5/Turbopack); `npm run start` on port 3100 → HTTP 200 with expected content; `npm run dev` on port 3101 → HTTP 200; `agentRules: false` verified to keep `AGENTS.md` unchanged | Next 16 requires `jsx: "react-jsx"`; `next-env.d.ts` is generated and ignored; scaffold contains no Tailwind, ESLint boilerplate, shadcn/ui, demo assets, or product dependencies; strict TypeScript flags remain for Prompt 007 |
| 007 | Configure Strict TypeScript | ✅ Completed | `tsconfig.json`, `package.json` (`typecheck` script), `src/lib/contracts/common.ts` (new), `CONVENTIONS.md`, `coding-conventions.md`, `PROJECT_STATUS.md`, `progress-tracker.md`, `implementation-plan.md`, `CHANGELOG.md` | `npm run typecheck` (exit 0; `next typegen` + `tsc --noEmit`); `npm run build` (exit 0); source scan found no `any`, `@ts-ignore`, `@ts-expect-error`, or unsafe assertions | Strict flags enabled; shared cross-cutting contracts only; no speculative types or empty module directories; database credentials remain an environment prerequisite, not a code decision; typecheck runs `next typegen` for clean checkouts |
| 008 | Establish the Application Directory Structure | ⏸ Not started | — | — | — |

---

## 6. Next Task

**Prompt 008 — Establish the Application Directory Structure.**

Create a modular directory structure separating App Router routes, public pages, admin pages, UI components, domain modules, database access, shared utilities, validation, API handlers, and tests.

Avoid placing all business logic inside route components or Server Actions. Keep server-only code clearly separated from browser-accessible code.

**Completion:** The directory structure supports independent development of the major platform modules.

**Constraint:** Create only directories with a current purpose. Do not pre-create empty module directories or speculative domain types; each module's structure is added when its implementation begins.
