# Admin Sidebar and Breadcrumbs (Prompt 050) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make System Configuration and Roles & permissions Super Admin-only in the centralized navigation, enforce the same rule at the API and service boundaries with one reusable guard, and make breadcrumbs correct for the planned nested admin routes.

**Architecture:** Extend the existing authorization guards with a non-permission `requireSuperAdmin(actor)` based on `actor.isSuperAdmin`; add an explicit `superAdminOnly` flag to the single navigation model so visibility can never be driven by permission possession; apply the guard in the existing REST route handlers and their `'use server'` workflows; and move breadcrumb resolution into the shared client shell so `usePathname()` supplies the real path from the already-centralized label map.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-admin-sidebar-breadcrumbs-design.md`

## Global Constraints

- No new admin pages, placeholder routes, links, permission keys, schema changes, or migrations.
- `requireSuperAdmin` must check `actor.isSuperAdmin` only; it is never a permission check.
- Existing canonical guards, last-Super-Admin protections, and `googleSignOut` are unchanged.
- `ADMIN_NAVIGATION` is the single source of navigation; `ADMIN_ROUTE_LABELS` is the single source of breadcrumb labels.
- Super Admin-only entries: `settings` and `roles` only; `information-pages` stays permission-based; the whole System group is not Super Admin-only.
- `ADMIN_AREA_PERMISSIONS` excludes permissions that appear only on Super Admin-only entries.
- One commit total for Prompt 050. **No per-task commits and no push** until the hash and verification results are shown and explicit approval is received.
- `npm run lint` enforces `no-extra-parens` and `arrow-body-style`: use early returns / single-line implicit returns, not parenthesized multi-line JSX or single-return block arrows.
- Tests are not weakened or deleted to make the suite pass.

## Review Focus

1. **Non-Super-Admin with `admin.manage` calling role APIs** — must be `403`, never `200`, even though the permission previously allowed it.
2. **Super Admin calling role APIs** — must pass the guard and reach dispatch, not be over-blocked.
3. **Non-Super-Admin with `settings.manage` and the System group** — Information pages stays visible; only Settings/Roles disappear.
4. **Nested breadcrumbs** — `/admin/users` renders `Admin` (link) › `Users` (current `aria-current="page"`), current crumb never linked.
5. **Unlabelled/detail paths** — `/admin/users/42` and `/admin/unknown` still render a single `Admin` with no invented link.

---

### Task 1: `requireSuperAdmin` guard

**Files:**
- Modify: `src/modules/authorization/guards.ts`
- Modify: `src/modules/authorization/index.ts`
- Test: `tests/unit/modules/authorization/guards.test.ts`

**Interfaces:**
- Produces: `requireSuperAdmin(actor: ActorContext): ActorContext`, exported from both `guards.ts` and the module index. Throws `AuthenticationError` when `actor.userId === null`, throws `AuthorizationError` when `!actor.isSuperAdmin`, otherwise returns `actor`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/modules/authorization/guards.test.ts` (add `requireSuperAdmin` to the existing import list from `@/modules/authorization/guards`):

```ts
describe('requireSuperAdmin', () => {
  it('rejects anonymous actors with AuthenticationError', () => {
    expect(() => requireSuperAdmin(anonymous)).toThrow(AuthenticationError);
  });

  it('rejects an authenticated non-Super-Admin even with admin.manage', () => {
    const adminManager: ActorContext = {
      userId: 'user-9',
      roles: ['admin'],
      isSuperAdmin: false,
      permissions: ['admin.manage'],
    };

    expect(() => requireSuperAdmin(adminManager)).toThrow(AuthorizationError);
  });

  it('returns the actor for a Super Admin', () => {
    expect(requireSuperAdmin(superAdmin)).toBe(superAdmin);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/modules/authorization/guards.test.ts`
Expected: FAIL — `requireSuperAdmin` is not exported.

- [ ] **Step 3: Implement the guard**

Add beside `requireAdmin` in `src/modules/authorization/guards.ts` (use `AuthenticationError` / `AuthorizationError`, already imported):

```ts
/**
 * Require that the actor is the Super Admin. Not a permission check:
 * `isSuperAdmin` is the authoritative definition.
 */
export function requireSuperAdmin(actor: ActorContext): ActorContext {
  if (actor.userId === null) {
    throw new AuthenticationError('Authentication required.');
  }
  if (!actor.isSuperAdmin) {
    throw new AuthorizationError('Super Admin permission required.');
  }
  return actor;
}
```

Add `requireSuperAdmin` to the `export { ... } from './guards'` line in `src/modules/authorization/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/modules/authorization/guards.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 2: Super Admin-only navigation entries

**Files:**
- Modify: `src/components/admin/navigation.ts`
- Test: `tests/unit/components/admin-navigation.test.ts`

**Interfaces:**
- `AdminNavEntry` gains `superAdminOnly?: boolean`.
- `superAdminOnly: true` on the `settings` and `roles` entries; `information-pages` stays `false`/absent.
- `filterAdminNavigation` hides a `superAdminOnly` entry from any actor with `!actor.isSuperAdmin`, before evaluating permissions.
- `ADMIN_AREA_PERMISSIONS` is the de-duplicated union of permissions from entries where `superAdminOnly !== true`. This drops `settings.read`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/components/admin-navigation.test.ts`, add a helper and tests. Keep every existing test.

```ts
function entryById(id: string) {
  return ALL_ENTRIES.find((entry) => entry.id === id);
}

describe('Super Admin-only entries', () => {
  it('marks only Settings and Roles & permissions', () => {
    expect(entryById('settings')?.superAdminOnly).toBe(true);
    expect(entryById('roles')?.superAdminOnly).toBe(true);
    expect(entryById('information-pages')?.superAdminOnly).not.toBe(true);
  });

  const systemGroup: readonly AdminNavGroup[] = [
    {
      id: 'system',
      label: 'System',
      entries: [
        {
          id: 'settings',
          label: 'Settings',
          href: '/admin/settings',
          permissions: ['settings.read', 'settings.manage', 'admin.manage'],
          implemented: true,
          superAdminOnly: true,
        },
        {
          id: 'roles',
          label: 'Roles & permissions',
          href: '/admin/roles',
          permissions: ['admin.manage'],
          implemented: true,
          superAdminOnly: true,
        },
        {
          id: 'information-pages',
          label: 'Information pages',
          href: '/admin/information-pages',
          permissions: ['settings.manage', 'admin.manage'],
          implemented: true,
        },
      ],
    },
  ];

  it('hides Super Admin-only entries from an actor with admin.manage', () => {
    const visible = filterAdminNavigation(systemGroup, actor(['admin.manage']));

    expect(visible[0]?.entries.map((entry) => entry.id)).toEqual(['information-pages']);
  });

  it('hides Super Admin-only entries from an actor with settings.manage', () => {
    const visible = filterAdminNavigation(systemGroup, actor(['settings.manage']));

    expect(visible[0]?.entries.map((entry) => entry.id)).toEqual(['information-pages']);
  });

  it('shows every system entry to a Super Admin', () => {
    const visible = filterAdminNavigation(systemGroup, actor([], true));

    expect(visible[0]?.entries.map((entry) => entry.id)).toEqual([
      'settings',
      'roles',
      'information-pages',
    ]);
  });

  it('excludes Super Admin-only permissions from the admin-area union', () => {
    expect(ADMIN_AREA_PERMISSIONS).not.toContain('settings.read');
    expect(ADMIN_AREA_PERMISSIONS).toContain('settings.manage');
    expect(ADMIN_AREA_PERMISSIONS).toContain('admin.manage');
  });

  it('denies an actor whose only permission is on a Super Admin-only entry', () => {
    expect(hasAdminAreaAccess(actor(['settings.read']))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/admin-navigation.test.ts`
Expected: FAIL — `superAdminOnly` is not part of the model; `settings.read` is still in the union.

- [ ] **Step 3: Implement the model change**

In `src/components/admin/navigation.ts`:

1. Add to `AdminNavEntry`:
   ```ts
   superAdminOnly?: boolean;
   ```
2. Add `superAdminOnly: true` to the `settings` and `roles` entries only.
3. In `isEntryVisible`, after the `implemented` check and before the permission check:
   ```ts
   if (entry.superAdminOnly === true && !actor.isSuperAdmin) {
     return false;
   }
   ```
4. Change `ADMIN_AREA_PERMISSIONS` to derive from non-Super-Admin-only entries:
   ```ts
   export const ADMIN_AREA_PERMISSIONS: readonly PermissionKey[] = Array.from(
     new Set(
       ADMIN_NAVIGATION.flatMap((group) => group.entries)
         .filter((entry) => entry.superAdminOnly !== true)
         .flatMap((entry) => entry.permissions)
     )
   );
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/admin-navigation.test.ts`
Expected: PASS (existing and new tests).

---

### Task 3: Admin gate regression for Super Admin-only permissions

**Files:**
- Test: `tests/unit/components/admin-access.test.ts`

**Interfaces:**
- Consumes: `resolveAdminPageAccess` (unchanged; it delegates to `hasAdminAreaAccess`).

- [ ] **Step 1: Update the failing expectations**

In `tests/unit/components/admin-access.test.ts`, remove `'settings.read'` from the allowed `it.each([...])` list, and add:

```ts
it('forbids an actor whose only permission belongs to a Super Admin-only entry', () => {
  expect(resolveAdminPageAccess(actor(['settings.read']), '/admin')).toEqual({ status: 'forbidden' });
});

it('denies a settings.read-only actor but allows a Super Admin and a non-Super-Admin operator', () => {
  expect(resolveAdminPageAccess(actor(['settings.read']), '/admin').status).toBe('forbidden');
  expect(resolveAdminPageAccess(actor([], true), '/admin').status).toBe('allowed');
  expect(resolveAdminPageAccess(actor(['admin.manage']), '/admin').status).toBe('allowed');
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-access.test.ts`
Expected: PASS (Task 2 already changed the union).

---

### Task 4: Planned nested breadcrumb labels

**Files:**
- Modify: `src/components/admin/breadcrumbs.ts`
- Test: `tests/unit/components/admin-breadcrumbs.test.ts`

**Interfaces:**
- `ADMIN_ROUTE_LABELS` gains the thirteen planned static routes below; `/admin` stays `Admin`. Resolver behavior is unchanged (unlabelled full path → `[{ label: 'Admin' }]`).

- [ ] **Step 1: Write the failing tests**

In `tests/unit/components/admin-breadcrumbs.test.ts`, replace the existing assertion `expect(ADMIN_ROUTE_LABELS).toEqual({ '/admin': 'Admin' })` with label checks, and add:

```ts
it('labels every planned nested admin route', () => {
  const planned = [
    '/admin/dramas',
    '/admin/movies',
    '/admin/episodes',
    '/admin/categories',
    '/admin/platforms',
    '/admin/reports',
    '/admin/reviews',
    '/admin/users',
    '/admin/analytics',
    '/admin/notifications',
    '/admin/settings',
    '/admin/roles',
    '/admin/information-pages',
  ];

  expect(planned.every((path) => typeof ADMIN_ROUTE_LABELS[path] === 'string')).toBe(true);
  expect(ADMIN_ROUTE_LABELS['/admin']).toBe('Admin');
  expect(ADMIN_ROUTE_LABELS['/admin/users']).toBe('Users');
  expect(ADMIN_ROUTE_LABELS['/admin/roles']).toBe('Roles & permissions');
});

it('resolves planned nested routes with the default labels', () => {
  expect(getAdminBreadcrumbs('/admin/users')).toEqual([
    { label: 'Admin', href: '/admin' },
    { label: 'Users' },
  ]);
  expect(getAdminBreadcrumbs('/admin/roles')).toEqual([
    { label: 'Admin', href: '/admin' },
    { label: 'Roles & permissions' },
  ]);
  expect(getAdminBreadcrumbs('/admin/settings?tab=1')).toEqual([
    { label: 'Admin', href: '/admin' },
    { label: 'Settings' },
  ]);
});

it('keeps the Admin fallback for unlabelled detail paths', () => {
  expect(getAdminBreadcrumbs('/admin/users/42')).toEqual([{ label: 'Admin' }]);
  expect(getAdminBreadcrumbs('/admin/unknown')).toEqual([{ label: 'Admin' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/admin-breadcrumbs.test.ts`
Expected: FAIL — the planned labels are missing.

- [ ] **Step 3: Add the labels**

Extend `ADMIN_ROUTE_LABELS` in `src/components/admin/breadcrumbs.ts` with these exact entries:

```ts
'/admin/dramas': 'Dramas',
'/admin/movies': 'Movies',
'/admin/episodes': 'Episodes',
'/admin/categories': 'Categories',
'/admin/platforms': 'Platforms',
'/admin/reports': 'Reports',
'/admin/reviews': 'Reviews',
'/admin/users': 'Users',
'/admin/analytics': 'Analytics',
'/admin/notifications': 'Notifications',
'/admin/settings': 'Settings',
'/admin/roles': 'Roles & permissions',
'/admin/information-pages': 'Information pages',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/admin-breadcrumbs.test.ts`
Expected: PASS.

---

### Task 5: Path-aware breadcrumbs in the shell

**Files:**
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/app/admin/layout.tsx`
- Test: `tests/unit/components/admin-shell.test.tsx`

**Interfaces:**
- `AdminShell` no longer takes a `breadcrumbs` prop; it computes `getAdminBreadcrumbs(pathname)` where `pathname = usePathname()`.
- `AdminHeader` keeps its `breadcrumbs` prop.

- [ ] **Step 1: Update the failing test**

In `tests/unit/components/admin-shell.test.tsx`: delete the `const breadcrumbs = [...]` declaration and the `breadcrumbs={breadcrumbs}` props from both the initial render and the rerender, then add:

```tsx
it('resolves nested breadcrumbs from the current pathname', () => {
  pathnameState.value = '/admin/users';

  renderShell();

  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  const current = nav.querySelector('[aria-current="page"]');
  const ancestor = nav.querySelector('a');

  expect(current?.textContent).toBe('Users');
  expect(current?.closest('a')).toBeNull();
  expect(ancestor?.getAttribute('href')).toBe('/admin');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-shell.test.tsx`
Expected: FAIL — the shell still renders the passed-in `Admin` breadcrumb and does not accept a nested path.

- [ ] **Step 3: Implement path-aware breadcrumbs**

In `src/components/admin/admin-shell.tsx`: remove the `breadcrumbs` prop and the `AdminBreadcrumb` type import; import `getAdminBreadcrumbs` from `./breadcrumbs`; compute `const breadcrumbs = getAdminBreadcrumbs(pathname);` after `const pathname = usePathname();` and pass it to `<AdminHeader breadcrumbs={breadcrumbs} user={user} />`.

In `src/app/admin/layout.tsx`: remove the `getAdminBreadcrumbs` import and the `breadcrumbs` variable, and stop passing `breadcrumbs` to `<AdminShell>`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/unit/components/admin-shell.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 6: Super Admin-only enforcement in the roles route

**Files:**
- Modify: `src/app/admin/api/roles/route.ts`
- Test: `tests/unit/app/admin-api-roles.test.ts` (new)

**Interfaces:**
- Consumes: `resolveActor`, `requireSuperAdmin` from `@/modules/authorization`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/admin-api-roles.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveActorMock, createRoleMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  createRoleMock: vi.fn(),
}));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const actors = await vi.importActual<typeof import('@/modules/authorization/actors')>(
    '@/modules/authorization/actors'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...permissions, ...guards, ...actors, resolveActor: resolveActorMock };
});

vi.mock('@/workflows/admin/roles', () => ({
  createRole: createRoleMock,
  editRole: vi.fn(),
  assignPermission: vi.fn(),
  revokePermission: vi.fn(),
  getRolePermissions: vi.fn(),
  validateSuperAdminAccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { GET } from '@/app/admin/api/roles/route';

const anonymous = { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
const adminManager = { userId: 'u1', roles: ['admin'], isSuperAdmin: false, permissions: ['admin.manage'] };
const superAdmin = { userId: 'u2', roles: ['super_admin'], isSuperAdmin: true, permissions: [] };

function request(query = '') {
  return new Request(`http://localhost:3000/admin/api/roles${query}`);
}

beforeEach(() => {
  resolveActorMock.mockReset();
  createRoleMock.mockReset();
});

describe('GET /admin/api/roles', () => {
  it('returns 401 for anonymous actors', async () => {
    resolveActorMock.mockResolvedValue(anonymous);

    const response = await GET(request('?action=create-role'));

    expect(response.status).toBe(401);
  });

  it('returns 403 for a non-Super-Admin holding admin.manage', async () => {
    resolveActorMock.mockResolvedValue(adminManager);

    const response = await GET(request('?action=create-role'));

    expect(response.status).toBe(403);
    expect(createRoleMock).not.toHaveBeenCalled();
  });

  it('lets a Super Admin reach the action dispatch', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);

    const response = await GET(request());

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Missing action');
  });

  it('runs the role action for a Super Admin', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);
    createRoleMock.mockResolvedValue({ success: true, role: { id: 'r1', name: 'editors' } });

    await expect(GET(request('?action=create-role&name=editors'))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(createRoleMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/app/admin-api-roles.test.ts`
Expected: FAIL — the route still uses `requirePermission('admin.manage')`, so the non-Super-Admin case returns a redirect/200 path instead of 403.

- [ ] **Step 3: Swap the guard**

In `src/app/admin/api/roles/route.ts`, change the import to `import { resolveActor, requireSuperAdmin } from '@/modules/authorization';` (drop `requirePermission` and `toPermissionKey` — they become unused) and replace the guard call with:

```ts
const actor = await resolveActor();
requireSuperAdmin(actor);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/app/admin-api-roles.test.ts`
Expected: PASS, 4 tests.

---

### Task 7: Selective Super Admin-only enforcement in the users route

**Files:**
- Modify: `src/app/admin/api/users/route.ts`
- Test: `tests/unit/app/admin-api-users.test.ts` (new)

**Interfaces:**
- `authorize-admin` → `requireSuperAdmin(actor)`; `deactivate-admin`, `reactivate-admin`, `inspect-role`, and a missing action → `requirePermission(actor, 'admin.manage')`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/admin-api-users.test.ts` with the same authorization mock factory as Task 6, plus:

```ts
const { resolveActorMock, authorizeMock, deactivateMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  authorizeMock: vi.fn(),
  deactivateMock: vi.fn(),
}));

vi.mock('@/workflows/admin/users', () => ({
  authorizeUserAsAdmin: authorizeMock,
  deactivateAdminUser: deactivateMock,
  reactivateAdminUser: vi.fn(),
  inspectUserRole: vi.fn(),
}));

import { GET } from '@/app/admin/api/users/route';

describe('GET /admin/api/users', () => {
  it('returns 401 for anonymous actors on authorize-admin', async () => {
    resolveActorMock.mockResolvedValue(anonymous);

    const response = await GET(request('?action=authorize-admin'));

    expect(response.status).toBe(401);
  });

  it('returns 403 for a non-Super-Admin holding admin.manage on authorize-admin', async () => {
    resolveActorMock.mockResolvedValue(adminManager);

    const response = await GET(request('?action=authorize-admin'));

    expect(response.status).toBe(403);
    expect(authorizeMock).not.toHaveBeenCalled();
  });

  it('lets a Super Admin authorize an administrator', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);
    authorizeMock.mockResolvedValue({ success: true });

    await expect(GET(request('?action=authorize-admin'))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(authorizeMock).toHaveBeenCalled();
  });

  it('keeps deactivate-admin available to a permitted non-Super-Admin', async () => {
    resolveActorMock.mockResolvedValue(adminManager);
    deactivateMock.mockResolvedValue({ success: true });

    await expect(GET(request('?action=deactivate-admin'))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(deactivateMock).toHaveBeenCalled();
  });

  it('returns 401 for anonymous actors on deactivate-admin', async () => {
    resolveActorMock.mockResolvedValue(anonymous);

    const response = await GET(request('?action=deactivate-admin'));

    expect(response.status).toBe(401);
  });
});
```

`request` builds `http://localhost:3000/admin/api/users`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/app/admin-api-users.test.ts`
Expected: FAIL — `authorize-admin` is not yet Super Admin-only.

- [ ] **Step 3: Implement the per-action guard**

In `src/app/admin/api/users/route.ts`, add `requireSuperAdmin` to the import, then replace the single guard block with action-aware guarding (keep `requirePermission` and `toPermissionKey` for the other actions):

```ts
const actor = await resolveActor();
const { searchParams } = new URL(request.url);
const action = searchParams.get('action');

if (action === 'authorize-admin') {
  requireSuperAdmin(actor);
} else {
  requirePermission(actor, toPermissionKey('admin', 'manage'));
}

if (!action) {
  return new Response('Missing action', { status: 400 });
}
```

Leave the existing `switch (action)` dispatch and the `AppError` mapping unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/app/admin-api-users.test.ts`
Expected: PASS, 5 tests.

---

### Task 8: Service-boundary enforcement in the roles workflow

**Files:**
- Modify: `src/workflows/admin/roles.ts`
- Test: `tests/unit/workflows/admin/roles.test.ts` (new)

**Interfaces:**
- All six functions (`createRole`, `editRole`, `assignPermission`, `revokePermission`, `getRolePermissions`, `validateSuperAdminAccess`) call `requireSuperAdmin(actor)` at the service boundary.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/workflows/admin/roles.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, AuthorizationError } from '@/platform/errors';

const { resolveActorMock } = vi.hoisted(() => ({ resolveActorMock: vi.fn() }));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const actors = await vi.importActual<typeof import('@/modules/authorization/actors')>(
    '@/modules/authorization/actors'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...permissions, ...guards, ...actors, resolveActor: resolveActorMock };
});

import {
  assignPermission,
  createRole,
  editRole,
  getRolePermissions,
  revokePermission,
  validateSuperAdminAccess,
} from '@/workflows/admin/roles';

const anonymous = { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
const adminManager = {
  userId: 'u1',
  roles: ['admin'],
  isSuperAdmin: false,
  permissions: ['admin.manage'] as const,
};
const superAdmin = { userId: 'u2', roles: ['super_admin'], isSuperAdmin: true, permissions: [] };

const calls = [
  ['createRole', () => createRole('editors', 'Editors')],
  ['editRole', () => editRole('role-1')],
  ['assignPermission', () => assignPermission('role-1', 'manage', 'admin')],
  ['revokePermission', () => revokePermission('role-1', 'manage', 'admin')],
  ['getRolePermissions', () => getRolePermissions('role-1')],
  ['validateSuperAdminAccess', () => validateSuperAdminAccess()],
] as const;

beforeEach(() => {
  resolveActorMock.mockReset();
});

describe('roles workflow authorization', () => {
  it.each(calls)('%s rejects anonymous actors', async (_name, call) => {
    resolveActorMock.mockResolvedValue(anonymous);
    await expect(call()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it.each(calls)('%s rejects a non-Super-Admin with admin.manage', async (_name, call) => {
    resolveActorMock.mockResolvedValue(adminManager);
    await expect(call()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it.each(calls)('%s runs for a Super Admin', async (_name, call) => {
    resolveActorMock.mockResolvedValue(superAdmin);
    await expect(call()).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/workflows/admin/roles.test.ts`
Expected: FAIL — the workflow currently calls `requirePermission('admin.manage')`, so the non-Super-Admin case resolves instead of throwing.

- [ ] **Step 3: Swap the service guard**

In `src/workflows/admin/roles.ts`, change the import to `import { requireSuperAdmin, resolveActor } from '@/modules/authorization';` and replace every `requirePermission(actor, toPermissionKey('admin', 'manage'));` with `requireSuperAdmin(actor);`. Update the file header comment's guard name if it names `requirePermission`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/workflows/admin/roles.test.ts`
Expected: PASS.

---

### Task 9: Selective service-boundary enforcement in the users workflow

**Files:**
- Modify: `src/workflows/admin/users.ts`
- Test: `tests/unit/workflows/admin/users.test.ts` (new)

**Interfaces:**
- `authorizeUserAsAdmin` calls `requireSuperAdmin`; `deactivateAdminUser`, `reactivateAdminUser`, and `inspectUserRole` keep `requirePermission(actor, 'admin.manage')`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/workflows/admin/users.test.ts` with the same authorization mock factory as Task 8, then:

```ts
import {
  authorizeUserAsAdmin,
  deactivateAdminUser,
  inspectUserRole,
  reactivateAdminUser,
} from '@/workflows/admin/users';

describe('users workflow authorization', () => {
  it('denies authorizeUserAsAdmin to a non-Super-Admin with admin.manage', async () => {
    resolveActorMock.mockResolvedValue(adminManager);
    await expect(authorizeUserAsAdmin()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('denies authorizeUserAsAdmin to anonymous actors', async () => {
    resolveActorMock.mockResolvedValue(anonymous);
    await expect(authorizeUserAsAdmin()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('allows authorizeUserAsAdmin for a Super Admin', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);
    await expect(authorizeUserAsAdmin()).resolves.toMatchObject({ success: true });
  });

  it.each([
    ['deactivateAdminUser', () => deactivateAdminUser()],
    ['reactivateAdminUser', () => reactivateAdminUser()],
    ['inspectUserRole', () => inspectUserRole()],
  ] as const)('%s keeps working for a permitted non-Super-Admin', async (_name, call) => {
    resolveActorMock.mockResolvedValue(adminManager);
    await expect(call()).resolves.toMatchObject({ success: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/workflows/admin/users.test.ts`
Expected: FAIL — `authorizeUserAsAdmin` still uses `requirePermission`.

- [ ] **Step 3: Implement the selective guard**

In `src/workflows/admin/users.ts`, add `requireSuperAdmin` to the import and change **only** `authorizeUserAsAdmin`'s guard to `requireSuperAdmin(actor);`. Leave the other three functions on `requirePermission(actor, toPermissionKey('admin', 'manage'));`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/workflows/admin/users.test.ts`
Expected: PASS.

---

### Task 10: Documentation, full verification, and the single commit

**Files:**
- Modify: `docs/decisions/DECISIONS.md` (new D-025)
- Modify: `docs/development/admin-shell.md`
- Modify: `docs/CHANGELOG.md` (`0.5.0`)
- Modify: `docs/PROJECT_STATUS.md` (Prompt 050 row and current prompt)

- [ ] **Step 1: Record D-025**

Add to `docs/decisions/DECISIONS.md` after D-024, in the existing format:

```markdown
## D-025 - Super Admin-only administration surfaces

System Configuration and Roles & permissions are Super Admin-only. Their
navigation entries carry an explicit `superAdminOnly` flag in
`src/components/admin/navigation.ts`, every non-Super-Admin is hidden from them
regardless of permissions, and the same rule is enforced server-side by
`requireSuperAdmin(actor)` (which checks `actor.isSuperAdmin`, not a
permission) at the REST route and workflow boundaries. Information pages stays
permission-based (`settings.manage` / `admin.manage`). Permissions that exist
only on Super Admin-only entries are excluded from `ADMIN_AREA_PERMISSIONS`.
```

- [ ] **Step 2: Update `docs/development/admin-shell.md`**

Document the `superAdminOnly` flag and the Settings/Roles vs Information pages
split; the `requireSuperAdmin` guard and where it is enforced; the deferred
`ADMIN_AREA_PERMISSIONS` rule; the client breadcrumb source (`usePathname()`)
and the extended label map; and that API/service enforcement is covered by unit
tests because OAuth cannot be exercised locally.

- [ ] **Step 3: Update `docs/CHANGELOG.md` and `docs/PROJECT_STATUS.md`**

Add `## [0.5.0] - 2026-11-12` with the prompt number, behavior, changed files,
and the verification results from Step 4. Add the Prompt 050 row to the progress
log with the actual file list, test counts, and the known unverified item
(authenticated browser flows).

- [ ] **Step 4: Run the full verification gate**

Run, in order, and record the actual output:

```text
npm run typecheck
npm run lint
npm test
npm run test:integration
node "C:\Users\User\AppData\Local\Temp\opencode\dramascan-build.mjs"
npm run test:e2e
```

Expected: every command passes. Report the pre-existing build warning about the
main database lacking `information_pages.position` separately, not as a new
failure. If a cold dev compile causes an E2E timeout that passes on rerun,
record it separately.

- [ ] **Step 5: Review the diff for scope and secrets**

Run: `git status` and `git diff --check`.
Expected: only the files listed in this plan; no `.env*`, no `test-results/`,
no `.next/`, no debug code. Do **not** stage the unrelated pre-existing change
to `docs/superpowers/plans/2026-11-11-shared-loading-empty-states.md` if it is
still present.

- [ ] **Step 6: Create the single commit**

```bash
git add src/modules/authorization src/components/admin src/app/admin docs/superpowers/specs/2026-11-12-admin-sidebar-breadcrumbs-design.md docs/superpowers/plans/2026-11-12-admin-sidebar-breadcrumbs.md tests/unit docs/decisions/DECISIONS.md docs/development/admin-shell.md docs/CHANGELOG.md docs/PROJECT_STATUS.md
git commit -m "feat: enforce Super Admin-only admin surfaces and nested breadcrumbs (Prompt 050)"
```

Do **not** push. Report the commit hash, verification results, and the
unverified browser scenarios, then request explicit approval to push.

---

## Plan Self-Review

- **Spec coverage:** Super Admin-only nav → Task 2; guard → Task 1; API
  enforcement → Tasks 6–7; service enforcement → Tasks 8–9; gate regression →
  Task 3; breadcrumb labels → Task 4; nested breadcrumbs → Task 5; tests →
  Tasks 1–9; docs/commit → Task 10. No new pages, keys, or schema.
- **Deliberate deviations, both approved:** breadcrumbs move to the client shell
  via `usePathname()`; `ADMIN_AREA_PERMISSIONS` excludes Super Admin-only
  entries so a `settings.read`-only actor is forbidden at the gate.
- **Ordering:** the guard (Task 1) precedes its consumers; the union change
  (Task 2) precedes the gate regression test (Task 3); labels (Task 4) precede
  the shell (Task 5).
- **Type consistency:** `superAdminOnly?: boolean` is used by Tasks 2, 6, 7;
  `requireSuperAdmin(actor: ActorContext): ActorContext` is used by Tasks 6–9;
  `AdminShell` loses only the `breadcrumbs` prop (Task 5).
- **Calls made for the executor:** `inspect-role`, `deactivate-admin`, and
  `reactivate-admin` keep `admin.manage`; only `authorize-admin` becomes Super
  Admin-only among the users actions.
