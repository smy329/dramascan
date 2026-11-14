# Super Admin Email/Password Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give exactly one Super Admin account an email/password sign-in at a non-obvious URL, while regular users keep Google OAuth.

**Architecture:** Better Auth's `emailAndPassword` is enabled with `disableSignUp: true`, so credential sign-in works but nobody can register a password account through the API. A one-off seed script writes the only credential account (scrypt hash in `accounts.password`). A standalone route `/vault-7x9k-console` hosts the form; anonymous `/admin` requests redirect there.

**Tech Stack:** Next.js 16 App Router, Better Auth 1.7.18, Drizzle ORM, PostgreSQL 18, Zod, React Hook Form, Vitest, Playwright.

**Spec:** This plan (decisions captured 2026-11-14: keep Google for users, separate admin URL, DB hash via explicit seed script).

## Global Constraints

- Google OAuth stays enabled for regular users; no email/password sign-up UI or endpoint.
- `SUPER_ADMIN_EMAIL=root-ctrl-x97@dramascan.com`; password supplied by the operator, stored only as a hash.
- Admin route is exactly `/vault-7x9k-console` (no links from public or admin navigation).
- No new runtime dependencies; seed script uses `pg` + `better-auth/crypto`.
- Secrets never printed by scripts, logs, tests, or error messages.
- Deactivated/soft-deleted accounts remain blocked by the existing session hook.

## Review Focus

- Wrong password must not reveal whether the email exists (single generic message).
- The vault route must not be indexed and must not be reachable from any navigation.
- Signing in with a non-Super-Admin identity must not grant `/admin` (existing authorization gate).
- Re-running the seed must reset the password without duplicating users/accounts.
- A missing/invalid `SUPER_ADMIN_PASSWORD` must fail loudly, never create an empty credential.

---

### Task 1: Redirect anonymous admin traffic to the vault route

**Files:**
- Modify: `src/lib/redirects.ts`
- Test: `tests/unit/lib/redirects.test.ts`, `tests/unit/components/admin-access.test.ts`

**Interfaces:**
- Produces: `ADMIN_SIGN_IN_PATH = '/vault-7x9k-console'`, `sanitizeAdminCallback(value: unknown): string`, `buildAdminSignInUrl(requestedPath: unknown): string`.

- [ ] **Step 1: Update failing tests** — expect `/vault-7x9k-console?callbackUrl=%2Fadmin`, and `sanitizeAdminCallback('/dashboard') === '/admin'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/lib/redirects.test.ts tests/unit/components/admin-access.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the constant, `sanitizeAdminCallback`, and the new URL base.
- [ ] **Step 4: Re-run** — expect PASS.

### Task 2: Shared credential schema and sign-in action

**Files:**
- Create: `src/workflows/auth/super-admin-credentials.ts`, `src/workflows/auth/super-admin-sign-in.ts`
- Test: `tests/unit/workflows/auth/super-admin-credentials.test.ts`

**Interfaces:**
- Produces: `superAdminCredentialsSchema` (email + password, password min 16), `type SuperAdminCredentials`, `signInSuperAdmin(values: SuperAdminCredentials): Promise<{ ok: false; message: string }>` (redirects on success).

- [ ] **Step 1: Write failing schema tests** — accepts a valid pair, lowercases/trims email, rejects empty password and email, rejects password < 16.
- [ ] **Step 2: Run** — expect FAIL (module missing).
- [ ] **Step 3: Implement** schema (framework-free) and the `'use server'` action calling `auth.api.signInEmail`, mapping every failure to `Invalid email or password.`.
- [ ] **Step 4: Run** — expect PASS.

### Task 3: Enable credential sign-in in Better Auth

**Files:**
- Modify: `src/platform/auth/better-auth.ts`

- [ ] **Step 1** Set `emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: false, minPasswordLength: 16 }` and `rateLimit.customRules['/sign-in/email'] = { window: 60, max: 5 }`.
- [ ] **Step 2** Run `npm run typecheck` — expect PASS.

### Task 4: Seed script

**Files:**
- Create: `scripts/seed-super-admin.mjs`
- Modify: `package.json`, `.env.local` (add quoted `SUPER_ADMIN_PASSWORD`), `.env.example`
- Test: `tests/integration/auth/super-admin-seed.integration.test.ts`

**Interfaces:**
- Produces: `npm run db:seed:super-admin`; idempotent upsert of `users` + credential `accounts` row.

- [ ] **Step 1: Write the failing integration test** — spawn the script against `TEST_DATABASE_URL` (name must end `_test`), assert `users.is_super_admin`, one `credential` account, `verifyPassword` succeeds, second run keeps one row and updates the hash; clean up.
- [ ] **Step 2: Run** — expect FAIL (script missing).
- [ ] **Step 3: Implement** the script; never print secrets; exit non-zero on invalid input.
- [ ] **Step 4: Run** — expect PASS.

### Task 5: Vault sign-in route

**Files:**
- Create: `src/app/vault-7x9k-console/page.tsx`, `src/app/vault-7x9k-console/super-admin-sign-in-form.tsx`
- Test: `tests/e2e/super-admin-signin.spec.ts`, `tests/e2e/support/credential-account.mjs`

- [ ] **Step 1: Write the failing E2E test** — seed credential in test DB; correct password reaches `/admin` with Super Admin shell; wrong password stays on the vault page with `Invalid email or password.`; page has `noindex`.
- [ ] **Step 2: Run** — expect FAIL (404).
- [ ] **Step 3: Implement** the server page (session redirect, `noindex`) and the RHF form.
- [ ] **Step 4: Run** — expect PASS.

### Task 6: Documentation and status

**Files:**
- Modify: `docs/decisions/DECISIONS.md` (D-027), `docs/architecture/SECURITY.md`, `docs/PROJECT_STATUS.md`, `docs/CHANGELOG.md`, `docs/development/CONVENTIONS.md` (env table)

- [ ] **Step 1** Record D-027 (supersedes "Google OAuth only" for the Super Admin), the vault URL, and the seed procedure.
- [ ] **Step 2** Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run build`.
- [ ] **Step 3** Commit and push (`feat: add super admin password sign-in`).
