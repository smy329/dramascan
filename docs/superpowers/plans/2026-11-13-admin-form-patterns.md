# Admin Form Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the shared admin create/edit form pattern kit — React Hook Form + Zod client validation, Server Action submission, validation messages, dirty-state warning, saving indicator, and server error display — as reusable components under `src/components/admin/forms/`.

**Architecture:** A client-side kit of three components (`AdminForm`, `AdminFormField`, `AdminFormError`) that composes React Hook Form (with `@hookform/resolvers` `zodResolver`) over a caller-supplied domain Zod schema, submits through a Server Action returning the standard `ActionResult`, and renders the five required patterns. The listing-side sibling kit (`src/components/admin/data-table/`) is the structural precedent.

**Tech Stack:** React 19 + React Hook Form + `@hookform/resolvers` (`zodResolver`) over Zod 4, Next.js Server Actions, Base UI + Tailwind (vendored `src/components/ui/`), Vitest + React Testing Library, jsdom per component test file.

**Spec:** `docs/superpowers/specs/2026-11-13-admin-form-patterns-design.md`

## Global Constraints

- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`), no `any`, no `@ts-ignore`, no non-null assertions, no enums, explicit return types on exports, type-only imports, `readonly` for immutable data, discriminated unions for results, parse-don't-cast.
- Server Actions return `{ ok: true; data } | { ok: false; error }`; never throw raw errors across the boundary; server re-validates and stays authoritative.
- `components` may import `lib`/`lib/contracts` and shared UI only — never modules; no barrel files in component folders; kebab-case file names; server-presentational vs client-interactive boundary.
- `"use client"` only where interactivity is required; reduced-motion classes on animated elements; no `console.*` in application code.
- Testing: jsdom opt-in per component test file (`// @vitest-environment jsdom`), RTL, `cleanup` in `afterEach`, user-observable assertions (roles, names, text, alerts).

## Review Focus

The spec implies failure modes no task's tests exercise that are most likely to bite a user of this software:

1. A server `fieldErrors` entry for a field whose control is not registered (after reset) — must not crash, must not mislead.
2. `isSubmitting` must clear after a failed save so the administrator can retry.
3. Resolver-driven validation must run on submit through `noValidate` (native constraint validation must not shadow Zod messages).
4. Context typing between `AdminForm` (form state) and `AdminFormField` (field registration) must stay type-safe.
5. Dirty tracking (`formState.dirtyFields`) and the `beforeunload` listener lifecycle must not leak across renders/unmounts.

---

## Tasks

### Task 1: Install the shared form stack

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `react-hook-form` and `@hookform/resolvers` installed with versions compatible with React 19 and Zod 4; `zodResolver` importable from `@hookform/resolvers/zod`.

- [ ] **Step 1: Install the dependencies**

```bash
npm install react-hook-form @hookform/resolvers
```

- [ ] **Step 2: Verify the resolver resolves against the installed Zod version**

Run: `npm run typecheck`

Expected: typecheck passes once the kit consumes the resolver; no resolver/Zod type errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add react-hook-form and @hookform/resolvers for admin forms (Prompt 052)"
```

---

### Task 2: `AdminFormError` — server error alert

**Files:**
- Create: `src/components/admin/forms/admin-form-error.tsx`
- Test: `tests/unit/components/admin-form-error.test.tsx`

**Interfaces:**
- Produces: `AdminFormError` with props `{ title?: string; message?: string; children?: ReactNode; className?: string }` returning a `role="alert"` destructive panel; heading default `'Could not save'`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/components/admin-form-error.test.tsx` (jsdom):
- renders an alert with the default title and message;
- renders a custom title and message;
- renders the optional action slot as children;
- merges a custom `className`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-form-error.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AdminFormError`**

Create `src/components/admin/forms/admin-form-error.tsx` (no `"use client"`; presentational, mirrors `AdminTableError` which wraps `RetryState`). Use destructive-tinted alert styling, `role="alert"`, optional action slot.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-form-error.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/forms/admin-form-error.tsx tests/unit/components/admin-form-error.test.tsx
git commit -m "feat: add admin form error alert (Prompt 052)"
```

---

### Task 3: `AdminFormField` — labeled field with validation message

**Files:**
- Create: `src/components/admin/forms/admin-form-field.tsx`
- Test: `tests/unit/components/admin-form-field.test.tsx`

**Interfaces:**
- Produces: `AdminFormField` (client) with props `{ name: string; label: string; type?: string; required?: boolean; hint?: string; multiline?: boolean; autoComplete?: string; className?: string }` that registers via the RHF context, renders label/control/hint/error, and wires `aria-invalid` + `aria-describedby`.

- [ ] **Step 1: Write the failing tests**

- renders a labelled control with the label associated via `htmlFor`;
- renders the hint when provided;
- renders the validation error from the RHF context and wires `aria-invalid`/`aria-describedby`;
- applies the `required` marker.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/admin-form-field.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AdminFormField`**

Create `src/components/admin/forms/admin-form-field.tsx` (`"use client"`), consume `useFormContext`, `register(name)`, `formState.errors`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/admin-form-field.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/forms/admin-form-field.tsx tests/unit/components/admin-form-field.test.tsx
git commit -m "feat: add admin form field with validation messaging (Prompt 052)"
```

---

### Task 4: `AdminForm` — create/edit shell

**Files:**
- Create: `src/components/admin/forms/admin-form.tsx`
- Test: `tests/unit/components/admin-form.test.tsx`

**Interfaces:**
- Produces: `AdminForm` (client) with props:

```ts
type AdminFormServerAction = (payload: unknown) => Promise<ActionResult<unknown>>;

export type AdminFormProps = Readonly<{
  schema: z.ZodType<Record<string, unknown>>; // domain create/edit schema
  serverAction: AdminFormServerAction;
  defaultValues?: Readonly<Record<string, unknown>>;
  onSuccess?: (data: unknown) => void | Promise<void>;
  resetOnSuccess?: boolean; // default true
  submitLabel?: string; // default 'Save'
  pendingLabel?: string; // default 'Saving…'
  className?: string;
  children: ReactNode;
}>;
```

Behavior:
1. `useForm({ resolver: zodResolver(schema), defaultValues, mode: 'onChange' })`.
2. `<FormProvider {...methods}>` + `<form onSubmit={handleSubmit(onValid, onInvalid)} noValidate>`.
3. `onValid`: `const result = await serverAction(data)`; on `ok` reset when `resetOnSuccess` and call `onSuccess`; on `ok: false` map `error.fieldErrors` via `setError` and hold the error for `AdminFormError`.
4. Submit footer: submit `Button` disabled + `aria-busy` + pending label.

- [ ] **Step 1: Write the failing tests**

`tests/unit/components/admin-form.test.tsx` (jsdom):
- renders the form with a registered field and a submit control;
- calls the server action on valid submit and resets + calls `onSuccess`;
- blocks the server action and shows resolver errors when validation fails;
- renders `AdminFormError` and maps server `fieldErrors` onto fields on `ok: false`;
- disables the submit control and swaps the label while pending.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/admin-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AdminForm`**

Create `src/components/admin/forms/admin-form.tsx` (`"use client"`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/admin-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/forms/admin-form.tsx tests/unit/components/admin-form.test.tsx
git commit -m "feat: add shared admin form shell (Prompt 052)"
```

---

### Task 5: Update project documentation

**Files:**
- Create: `docs/development/admin-forms.md`
- Modify: `docs/README.md`, `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md`, `docs/development/admin-data-tables.md` (related-document links)

- [ ] **Step 1: Write the design-doc-adjacent dev doc and update status/changelog**

- `docs/development/admin-forms.md`: new doc describing the kit's files, boundaries, props, behavior, and the server-authoritative validation rule.

- [ ] **Step 2: Update cross-references**

- `docs/README.md`: add quick link.
- `docs/CHANGELOG.md`: add the Prompt 052 entry under the current version heading.
- `docs/PROJECT_STATUS.md`: add the Prompt 052 row (prompt number, title, status, changed files, tests, notes).

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: document the shared admin form patterns (Prompt 052)"
```

---

### Task 6: Final verification gate

- [ ] **Step 1: Run the full verification gate**

Run, in order, and record actual output:

```text
npm run typecheck
npm run lint
npx vitest run tests/unit/components
npm run build
```

- [ ] **Step 2: Review the diff for scope and secrets**

Run: `git status` and `git diff --check`.
Expected: only the files listed in this plan; no `.env*`, no `test-results/`, no `.next/`, no debug code, no credentials.

- [ ] **Step 3: Report**

Provide the completion report: implementation status, verification results, commit hash, push status, unresolved issues.

---

## Commit map for Prompt 052

Per the enforced policy (per-task commits; final documentation commit on top):

1. `build: add react-hook-form and @hookform/resolvers for admin forms (Prompt 052)`
2. `feat: add admin form error alert (Prompt 052)`
3. `feat: add admin form field with validation messaging (Prompt 052)`
4. `feat: add shared admin form shell (Prompt 052)`
5. `docs: document the shared admin form patterns (Prompt 052)`

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-11-13-admin-form-patterns.md`.**

Please review the plan. Does it capture what you want?

Then choose an execution method before implementation:

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **native**, because the tasks are small, interface-coupled in a simple chain (error → field → shell → docs), and the whole feature fits in a few focused files.

Which approach should we use, and does the plan capture what you want?
