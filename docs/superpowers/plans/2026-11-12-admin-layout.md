# Admin Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected, responsive `/admin` shell with permission-filtered navigation, breadcrumbs, an account menu, and one functional overview page, without building any future admin section.

**Architecture:** `src/app/admin/layout.tsx` resolves the actor, enforces admin-area access, filters the central navigation model, and computes breadcrumbs on the server; a client shell renders only those permitted entries and owns the drawer/account-menu interactions. Pure modules hold the navigation model, access decision, breadcrumb resolution, and callback validation so every rule is unit-tested without a database or browser.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4 tokens, Base UI (`dialog`, `menu`), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-admin-layout-design.md`

## Global Constraints

- Only these routes may be created: `src/app/admin/layout.tsx` and `src/app/admin/page.tsx`. No route groups, no placeholder pages, no catch-all.
- No new dependencies, no schema changes, no migrations, no new permission keys. Use only keys already in `PERMISSIONS`.
- `ADMIN_NAVIGATION` is the single source of truth for navigation; each entry carries `implemented`, and only `implemented` entries may render.
- Navigation visibility is never authorization. The layout **and** page both call `requireAdminPageAccess`; every future operation keeps its own canonical guard.
- Do not use `requireAdmin` for the shell gate; it is narrower than the admin area (Content Managers and Analysts must get in).
- Dark design tokens only (`background`, `card`, `popover`, `muted`, `border`, `foreground`, `primary`, `accent`, `destructive`, `ring`). No hex values.
- Anonymous `/admin` → `/auth/signin?callbackUrl=<sanitized admin path>`. Authenticated non-admin → `notFound()`. No 403 page, no public-dashboard redirect.
- Existing session validation, `resolveActor`, and canonical guards are preserved unchanged.
- One commit total for Prompt 049, after the full verification gate. **No per-task commits, and no push** until the hash and verification results are shown and explicit approval is received.
- `npm run lint` enforces `no-extra-parens`; use early returns/render helpers instead of parenthesized JSX conditionals.
- Tests are not weakened or deleted to make the suite pass.

## Review Focus

1. **Callback that looks local but escapes scope** — `/adminish`, `/admin/../other`, `//evil.example`, `/\evil.example`, and absolute URLs must never become a post-sign-in destination; the sign-in page and the Server Action must both sanitize.
2. **Navigation model drifting from the catalog** — a typo or invented key must fail a test, and an unimplemented entry must stay invisible even when the actor holds its permission.
3. **Gate bypass and anonymous super-admin** — `{ userId: null, isSuperAdmin: true }` must be anonymous, and the page must refuse access even if the layout were skipped.
4. **Drawer regressions on mobile** — focus must move into the drawer, Escape must close it, focus must return to the trigger, body scroll must lock while open and restore after, and navigation must close it.
5. **Breadcrumb safety** — unknown paths must fall back to `Admin` without linking to nonexistent routes, and the current page must not be duplicated as a second title.

---

### Task 1: Local callback sanitizer

**Files:**
- Create: `src/lib/redirects.ts`
- Test: `tests/unit/lib/redirects.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_CALLBACK_URL = '/dashboard'`
  - `sanitizeLocalCallback(value: unknown): string | null`
  - `sanitizeCallbackUrl(value: unknown, fallback?: string): string`
  - `isAdminPath(value: string): boolean`
  - `buildAdminSignInUrl(requestedPath: unknown): string` → `/auth/signin?callbackUrl=<encoded admin path>` using `/admin` when the request is not a safe admin path.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALLBACK_URL,
  buildAdminSignInUrl,
  isAdminPath,
  sanitizeCallbackUrl,
  sanitizeLocalCallback,
} from '@/lib/redirects';

describe('sanitizeLocalCallback', () => {
  it.each(['/dashboard', '/admin', '/admin?tab=roles', '/admin#top', '/admin/users/42?x=1#y'])(
    'accepts local path %s',
    (value) => {
      expect(sanitizeLocalCallback(value)).toBe(value);
    }
  );

  it.each([
    'https://evil.example',
    'http://evil.example/admin',
    '//evil.example',
    '/\\evil.example',
    '\\/evil.example',
    'javascript:alert(1)',
    'admin',
    '',
    '   ',
    '  /admin',
    '/admin\n',
    null,
    undefined,
    42,
    {},
  ])('rejects unsafe value %s', (value) => {
    expect(sanitizeLocalCallback(value)).toBeNull();
  });

  it('normalizes dot segments instead of trusting the raw string', () => {
    expect(sanitizeLocalCallback('/admin/../other')).toBe('/other');
  });
});

describe('sanitizeCallbackUrl', () => {
  it('returns a valid local path unchanged', () => {
    expect(sanitizeCallbackUrl('/admin/users')).toBe('/admin/users');
  });

  it('returns the default fallback for unsafe input', () => {
    expect(sanitizeCallbackUrl('https://evil.example')).toBe(DEFAULT_CALLBACK_URL);
  });

  it('uses the supplied fallback only when it is itself safe', () => {
    expect(sanitizeCallbackUrl(null, '/admin')).toBe('/admin');
    expect(sanitizeCallbackUrl(null, 'https://evil.example')).toBe(DEFAULT_CALLBACK_URL);
  });
});

describe('isAdminPath', () => {
  it.each(['/admin', '/admin/', '/admin/users', '/admin?tab=1', '/admin#top'])(
    'accepts admin path %s',
    (value) => {
      expect(isAdminPath(value)).toBe(true);
    }
  );

  it.each(['/', '/dashboard', '/administrator', '/adminish', '/other/admin'])(
    'rejects non-admin path %s',
    (value) => {
      expect(isAdminPath(value)).toBe(false);
    }
  );
});

describe('buildAdminSignInUrl', () => {
  it('encodes the requested admin path', () => {
    expect(buildAdminSignInUrl('/admin')).toBe('/auth/signin?callbackUrl=%2Fadmin');
    expect(buildAdminSignInUrl('/admin/users?page=2')).toBe(
      '/auth/signin?callbackUrl=%2Fadmin%2Fusers%3Fpage%3D2'
    );
  });

  it('falls back to /admin for unsafe or non-admin requests', () => {
    expect(buildAdminSignInUrl('https://evil.example')).toBe(
      '/auth/signin?callbackUrl=%2Fadmin'
    );
    expect(buildAdminSignInUrl('/dashboard')).toBe('/auth/signin?callbackUrl=%2Fadmin');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/redirects.test.ts`
Expected: FAIL — cannot resolve `@/lib/redirects`.

- [ ] **Step 3: Implement `src/lib/redirects.ts`**

Rules the body must satisfy: reject non-strings, empty/whitespace-padded values, anything longer than 2048 characters, values not starting with a single `/`, `//`, any backslash, and ASCII control characters. Parse with `new URL(value, 'http://dramascan.local')`, require the origin to remain `http://dramascan.local`, and return `` `${url.pathname}${url.search}${url.hash}` ``.

`isAdminPath` returns true only for `'/admin'` or a value beginning with `/admin/`, `/admin?`, or `/admin#`.

`buildAdminSignInUrl` sanitizes the requested path, keeps it only when `isAdminPath` is true, and otherwise uses `/admin`; it returns `` `/auth/signin?callbackUrl=${encodeURIComponent(destination)}` ``.

Keep the module framework-free (no `next/*`, no `server-only`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/redirects.test.ts`
Expected: PASS, 6 describe blocks green.

---

### Task 2: Forward the callback through sign-in and Google OAuth

**Files:**
- Modify: `src/app/auth/signin/page.tsx`
- Modify: `src/workflows/auth/google-oauth.ts`
- Test: `tests/unit/workflows/auth/google-oauth.test.ts`

**Interfaces:**
- Consumes: `sanitizeCallbackUrl` from `@/lib/redirects`.
- Produces: `googleSignIn(formData: FormData): Promise<void>` — reads `callbackUrl` from the form, sanitizes it again server-side, and passes it as Better Auth `callbackURL`; `errorCallbackURL` preserves it.
- The sign-in page reads `searchParams.callbackUrl`, computes the destination with `sanitizeCallbackUrl(callbackUrl, '/dashboard')`, redirects an already signed-in user to that destination, and renders `<input type="hidden" name="callbackUrl" value={destination} />` inside the existing form.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signInSocialMock, redirectMock } = vi.hoisted(() => ({
  signInSocialMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('@/platform/auth/better-auth', () => ({
  auth: {
    api: {
      signInSocial: signInSocialMock,
      signOut: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import { googleSignIn } from '@/workflows/auth/google-oauth';

function formData(callbackUrl?: string): FormData {
  const data = new FormData();
  if (callbackUrl !== undefined) {
    data.set('callbackUrl', callbackUrl);
  }
  return data;
}

function bodySentToGoogle(): Record<string, unknown> {
  return signInSocialMock.mock.calls[0]?.[0]?.body ?? {};
}

beforeEach(() => {
  signInSocialMock.mockReset();
  redirectMock.mockReset();
  signInSocialMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth' });
});

describe('googleSignIn', () => {
  it('forwards a valid local callback URL', async () => {
    await googleSignIn(formData('/admin'));

    expect(bodySentToGoogle()).toMatchObject({
      provider: 'google',
      callbackURL: '/admin',
      errorCallbackURL: '/auth/signin?callbackUrl=%2Fadmin',
    });
    expect(redirectMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth');
  });

  it('drops an external callback URL', async () => {
    await googleSignIn(formData('https://evil.example'));

    expect(bodySentToGoogle()).toMatchObject({
      callbackURL: '/dashboard',
      errorCallbackURL: '/auth/signin',
    });
  });

  it('defaults to the dashboard when no callback is supplied', async () => {
    await googleSignIn(formData());

    expect(bodySentToGoogle()).toMatchObject({ callbackURL: '/dashboard' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/workflows/auth/google-oauth.test.ts`
Expected: FAIL — `googleSignIn` ignores the form value, so `callbackURL` stays `/dashboard`.

- [ ] **Step 3: Implement the change**

`google-oauth.ts`: change the signature to `googleSignIn(formData: FormData)`, derive `const callbackUrl = sanitizeCallbackUrl(formData.get('callbackUrl'), '/dashboard')`, and set `callbackURL: callbackUrl`. Set `errorCallbackURL` to `'/auth/signin'` when the destination is `/dashboard`, otherwise `` `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}` ``. Leave `googleSignOut` untouched.

`signin/page.tsx`: widen `searchParams` to `Promise<{ error?: string; callbackUrl?: string }>`, read both values before the session check, compute `const destination = sanitizeCallbackUrl(callbackUrl, '/dashboard')`, replace `redirect('/dashboard')` with `redirect(destination)`, and add the hidden input to the existing `<form action={googleSignIn}>`.

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run tests/unit/workflows/auth/google-oauth.test.ts`
Expected: PASS, 3 tests green.

Run: `npm run typecheck`
Expected: PASS (the form action type accepts the new signature).

---

### Task 3: Admin navigation model

**Files:**
- Create: `src/components/admin/navigation.ts`
- Test: `tests/unit/components/admin-navigation.test.ts`

**Interfaces:**
- Consumes: `hasPermission(actor, key)` from `@/modules/authorization/guards`; `PermissionKey` and `isPermissionKey` from `@/modules/authorization/permissions`; `ActorContext` as a type-only import.
- Produces:

```ts
export type AdminNavEntry = Readonly<{
  id: string;
  label: string;
  href: string;
  permissions: readonly PermissionKey[];
  implemented: boolean;
}>;

export type AdminNavGroup = Readonly<{
  id: string;
  label: string;
  entries: readonly AdminNavEntry[];
}>;

export const ADMIN_NAVIGATION: readonly AdminNavGroup[];
export const ADMIN_AREA_PERMISSIONS: readonly PermissionKey[];
export function hasAdminAreaAccess(actor: ActorContext): boolean;
export function filterAdminNavigation(
  groups: readonly AdminNavGroup[],
  actor: ActorContext
): readonly AdminNavGroup[];
export function isAdminNavItemActive(pathname: string, href: string): boolean;
```

**Model contents (ids are used by the entry icon map in Task 7):**

| Group id      | Entry id         | Label                 | Href                       | Permissions (any-of)                               | Implemented |
| ------------- | ---------------- | --------------------- | -------------------------- | -------------------------------------------------- | ----------- |
| `dashboard`   | `overview`       | `Overview`            | `/admin`                   | none (admin-area access)                           | true        |
| `content`     | `dramas`         | `Dramas`              | `/admin/dramas`            | `drama.read`                                       | false       |
| `content`     | `movies`         | `Movies`              | `/admin/movies`            | `movie.read`                                       | false       |
| `content`     | `episodes`       | `Episodes`            | `/admin/episodes`          | `episode.read`                                     | false       |
| `content`     | `categories`     | `Categories`          | `/admin/categories`        | `category.read`                                    | false       |
| `content`     | `platforms`      | `Platforms`           | `/admin/platforms`         | `platform.read`                                    | false       |
| `moderation`  | `reports`        | `Reports`             | `/admin/reports`           | `review.read`, `review.manage`                     | false       |
| `moderation`  | `reviews`        | `Reviews`             | `/admin/reviews`           | `review.read`, `review.manage`                     | false       |
| `users`       | `users`          | `Users`               | `/admin/users`             | `user.read`, `user.manage`                         | false       |
| `analytics`   | `analytics`      | `Analytics`           | `/admin/analytics`         | `analytics.read`                                   | false       |
| `notifications` | `notifications` | `Notifications`      | `/admin/notifications`     | `admin.manage`                                     | false       |
| `system`      | `settings`       | `Settings`            | `/admin/settings`          | `settings.read`, `settings.manage`, `admin.manage` | false       |
| `system`      | `roles`          | `Roles & permissions` | `/admin/roles`             | `admin.manage`                                     | false       |
| `system`      | `information-pages` | `Information pages` | `/admin/information-pages` | `settings.manage`, `admin.manage`                  | false       |

`ADMIN_AREA_PERMISSIONS` is the de-duplicated union of every entry's permissions. `hasAdminAreaAccess` returns false for `userId === null` **before** checking `isSuperAdmin`; otherwise true for Super Admin or when any derived key is held. Filtering drops unimplemented entries, drops entries whose permissions do not match, and drops empty groups; an entry with no permissions requires admin-area access.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '@/modules/authorization/actors';
import type { PermissionKey } from '@/modules/authorization/permissions';
import { isPermissionKey } from '@/modules/authorization/permissions';
import {
  ADMIN_AREA_PERMISSIONS,
  ADMIN_NAVIGATION,
  filterAdminNavigation,
  hasAdminAreaAccess,
  isAdminNavItemActive,
  type AdminNavGroup,
} from '@/components/admin/navigation';

function actor(permissions: readonly PermissionKey[] = [], isSuperAdmin = false): ActorContext {
  return { userId: 'user-1', roles: [], isSuperAdmin, permissions };
}

const ANONYMOUS: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

const ALL_ENTRIES = ADMIN_NAVIGATION.flatMap((group) => group.entries);

describe('ADMIN_NAVIGATION', () => {
  it('uses only canonical permission keys', () => {
    expect(ALL_ENTRIES.every((entry) => entry.permissions.every(isPermissionKey))).toBe(true);
    expect(ADMIN_AREA_PERMISSIONS.every(isPermissionKey)).toBe(true);
  });

  it('has unique ids and admin-only hrefs', () => {
    expect(new Set(ALL_ENTRIES.map((entry) => entry.id)).size).toBe(ALL_ENTRIES.length);
    expect(new Set(ALL_ENTRIES.map((entry) => entry.href)).size).toBe(ALL_ENTRIES.length);
    expect(ALL_ENTRIES.every((entry) => entry.href.startsWith('/admin'))).toBe(true);
  });

  it('implements only the overview entry for this prompt', () => {
    expect(ALL_ENTRIES.filter((entry) => entry.implemented).map((entry) => entry.id)).toEqual([
      'overview',
    ]);
  });
});

describe('hasAdminAreaAccess', () => {
  it('never grants anonymous actors, even when the super-admin flag is set', () => {
    expect(hasAdminAreaAccess(ANONYMOUS)).toBe(false);
    expect(hasAdminAreaAccess({ ...ANONYMOUS, isSuperAdmin: true })).toBe(false);
  });

  it('grants Super Admin and operational permissions', () => {
    expect(hasAdminAreaAccess(actor([], true))).toBe(true);
    expect(hasAdminAreaAccess(actor(['drama.read']))).toBe(true);
    expect(hasAdminAreaAccess(actor(['analytics.read']))).toBe(true);
  });

  it('denies authenticated actors with no admin-area permission', () => {
    expect(hasAdminAreaAccess(actor())).toBe(false);
  });
});

describe('filterAdminNavigation', () => {
  it('shows only the implemented overview to Super Admin', () => {
    const visible = filterAdminNavigation(ADMIN_NAVIGATION, actor([], true));

    expect(visible.map((group) => group.id)).toEqual(['dashboard']);
    expect(visible[0]?.entries.map((entry) => entry.id)).toEqual(['overview']);
  });

  it.each([ANONYMOUS, actor()])('renders nothing without admin-area access', (current) => {
    expect(filterAdminNavigation(ADMIN_NAVIGATION, current)).toEqual([]);
  });

  it('shows the implemented dashboard to any actor with admin-area access', () => {
    expect(filterAdminNavigation(ADMIN_NAVIGATION, actor(['drama.read'])).map((g) => g.id)).toEqual([
      'dashboard',
    ]);
  });

  it('applies any-of permissions and empties groups with no visible entries', () => {
    const groups: readonly AdminNavGroup[] = [
      {
        id: 'content',
        label: 'Content',
        entries: [
          {
            id: 'dramas',
            label: 'Dramas',
            href: '/admin/dramas',
            permissions: ['drama.read'],
            implemented: true,
          },
          {
            id: 'movies',
            label: 'Movies',
            href: '/admin/movies',
            permissions: ['movie.read'],
            implemented: true,
          },
        ],
      },
      {
        id: 'moderation',
        label: 'Moderation',
        entries: [
          {
            id: 'reviews',
            label: 'Reviews',
            href: '/admin/reviews',
            permissions: ['review.read', 'review.manage'],
            implemented: true,
          },
        ],
      },
    ];

    expect(filterAdminNavigation(groups, actor(['drama.read'])).map((g) => g.entries.map((e) => e.id))).toEqual([
      ['dramas'],
    ]);
    expect(filterAdminNavigation(groups, actor(['review.manage'])).map((g) => g.id)).toEqual([
      'moderation',
    ]);
    expect(filterAdminNavigation(groups, actor(['analytics.read']))).toEqual([]);
  });

  it('keeps unimplemented entries hidden even when permitted', () => {
    const group: readonly AdminNavGroup[] = [
      {
        id: 'content',
        label: 'Content',
        entries: [
          {
            id: 'dramas',
            label: 'Dramas',
            href: '/admin/dramas',
            permissions: ['drama.read'],
            implemented: false,
          },
        ],
      },
    ];

    expect(filterAdminNavigation(group, actor(['drama.read']))).toEqual([]);
  });
});

describe('isAdminNavItemActive', () => {
  it('matches /admin exactly', () => {
    expect(isAdminNavItemActive('/admin', '/admin')).toBe(true);
    expect(isAdminNavItemActive('/admin/dramas', '/admin')).toBe(false);
    expect(isAdminNavItemActive('/administrator', '/admin')).toBe(false);
  });

  it('matches nested paths below a section', () => {
    expect(isAdminNavItemActive('/admin/dramas', '/admin/dramas')).toBe(true);
    expect(isAdminNavItemActive('/admin/dramas/42', '/admin/dramas')).toBe(true);
    expect(isAdminNavItemActive('/admin/dramas-two', '/admin/dramas')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-navigation.test.ts`
Expected: FAIL — cannot resolve `@/components/admin/navigation`.

- [ ] **Step 3: Implement `src/components/admin/navigation.ts`**

Build `ADMIN_NAVIGATION` exactly as the table specifies. Derive `ADMIN_AREA_PERMISSIONS` with `Array.from(new Set(ADMIN_NAVIGATION.flatMap((group) => group.entries.flatMap((entry) => entry.permissions))))`.

Implement filtering with a small helper: return false when `!entry.implemented`; return `areaAccess` when `entry.permissions.length === 0`; otherwise `entry.permissions.some((key) => hasPermission(actor, key))`. Compute `areaAccess` once per filter call.

`isAdminNavItemActive`: `href === '/admin'` requires exact equality; otherwise active when `pathname === href || pathname.startsWith(`${href}/`)`.

Import `hasPermission` from `@/modules/authorization/guards` and keys from `@/modules/authorization/permissions`; do **not** import the authorization module index.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-navigation.test.ts`
Expected: PASS.

---

### Task 4: Admin page access decision

**Files:**
- Create: `src/components/admin/admin-access.ts`
- Test: `tests/unit/components/admin-access.test.ts`

**Interfaces:**
- Consumes: `buildAdminSignInUrl` from `@/lib/redirects`, `hasAdminAreaAccess` from `./navigation`, `ActorContext` (type only).
- Produces:

```ts
export type AdminPageAccess =
  | Readonly<{ status: 'allowed'; actor: ActorContext }>
  | Readonly<{ status: 'anonymous'; signInUrl: string }>
  | Readonly<{ status: 'forbidden' }>;

export function resolveAdminPageAccess(
  actor: ActorContext,
  requestedPath: string
): AdminPageAccess;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '@/modules/authorization/actors';
import type { PermissionKey } from '@/modules/authorization/permissions';
import { resolveAdminPageAccess } from '@/components/admin/admin-access';

function actor(permissions: readonly PermissionKey[] = [], isSuperAdmin = false): ActorContext {
  return { userId: 'user-1', roles: [], isSuperAdmin, permissions };
}

const ANONYMOUS: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

describe('resolveAdminPageAccess', () => {
  it('sends anonymous visitors to sign in with the encoded admin path', () => {
    expect(resolveAdminPageAccess(ANONYMOUS, '/admin')).toEqual({
      status: 'anonymous',
      signInUrl: '/auth/signin?callbackUrl=%2Fadmin',
    });
  });

  it('treats an anonymous super-admin flag as anonymous', () => {
    expect(resolveAdminPageAccess({ ...ANONYMOUS, isSuperAdmin: true }, '/admin').status).toBe(
      'anonymous'
    );
  });

  it('sanitizes unsafe requested paths before building the sign-in URL', () => {
    expect(resolveAdminPageAccess(ANONYMOUS, 'https://evil.example')).toEqual({
      status: 'anonymous',
      signInUrl: '/auth/signin?callbackUrl=%2Fadmin',
    });
    expect(resolveAdminPageAccess(ANONYMOUS, '/dashboard')).toEqual({
      status: 'anonymous',
      signInUrl: '/auth/signin?callbackUrl=%2Fadmin',
    });
  });

  it('forbids authenticated actors without admin-area access', () => {
    expect(resolveAdminPageAccess(actor(), '/admin')).toEqual({ status: 'forbidden' });
  });

  it.each([
    'drama.read',
    'movie.read',
    'episode.read',
    'category.read',
    'platform.read',
    'review.read',
    'review.manage',
    'user.read',
    'user.manage',
    'analytics.read',
    'settings.read',
    'settings.manage',
    'admin.manage',
  ] as const)('allows an actor holding %s', (permission) => {
    expect(resolveAdminPageAccess(actor([permission]), '/admin')).toEqual({
      status: 'allowed',
      actor: actor([permission]),
    });
  });

  it('always allows Super Admin', () => {
    const superAdmin = actor([], true);
    expect(resolveAdminPageAccess(superAdmin, '/admin')).toEqual({
      status: 'allowed',
      actor: superAdmin,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-access.test.ts`
Expected: FAIL — cannot resolve `@/components/admin/admin-access`.

- [ ] **Step 3: Implement `src/components/admin/admin-access.ts`**

Return `anonymous` (with `buildAdminSignInUrl(requestedPath)`) when `actor.userId === null`; otherwise return `forbidden` when `!hasAdminAreaAccess(actor)`; otherwise `allowed` with the same actor. Keep it framework-free.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-access.test.ts`
Expected: PASS.

---

### Task 5: Admin breadcrumbs

**Files:**
- Create: `src/components/admin/breadcrumbs.ts`
- Test: `tests/unit/components/admin-breadcrumbs.test.ts`

**Interfaces:**
- Produces:

```ts
export type AdminBreadcrumb = Readonly<{
  label: string;
  href?: string;
}>;

export const ADMIN_ROUTE_LABELS: Readonly<Record<string, string>>; // { '/admin': 'Admin' }
export function getAdminBreadcrumbs(
  pathname: string,
  labels?: Readonly<Record<string, string>>
): readonly AdminBreadcrumb[];
```

Behaviour: normalize by stripping query/hash and trailing slashes; return `[{ label: 'Admin' }]` when the path is not `/admin` or below it, or when the full path has no known label; otherwise walk the segments and produce one crumb per labelled ancestor, with `href` on every crumb except the last.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROUTE_LABELS,
  getAdminBreadcrumbs,
} from '@/components/admin/breadcrumbs';

const LABELS = {
  '/admin': 'Admin',
  '/admin/users': 'Users',
  '/admin/users/roles': 'Roles',
} as const;

describe('getAdminBreadcrumbs', () => {
  it('returns a single current item for /admin', () => {
    expect(getAdminBreadcrumbs('/admin')).toEqual([{ label: 'Admin' }]);
    expect(ADMIN_ROUTE_LABELS).toEqual({ '/admin': 'Admin' });
  });

  it('links known ancestors and leaves the current item unlinked', () => {
    expect(getAdminBreadcrumbs('/admin/users', LABELS)).toEqual([
      { label: 'Admin', href: '/admin' },
      { label: 'Users' },
    ]);
    expect(getAdminBreadcrumbs('/admin/users/roles', LABELS)).toEqual([
      { label: 'Admin', href: '/admin' },
      { label: 'Users', href: '/admin/users' },
      { label: 'Roles' },
    ]);
  });

  it('falls back to Admin for unknown paths without inventing links', () => {
    expect(getAdminBreadcrumbs('/admin/unknown', LABELS)).toEqual([{ label: 'Admin' }]);
    expect(getAdminBreadcrumbs('/dashboard', LABELS)).toEqual([{ label: 'Admin' }]);
  });

  it('normalizes trailing slashes and query strings', () => {
    expect(getAdminBreadcrumbs('/admin/', LABELS)).toEqual([{ label: 'Admin' }]);
    expect(getAdminBreadcrumbs('/admin?tab=1', LABELS)).toEqual([{ label: 'Admin' }]);
    expect(getAdminBreadcrumbs('/admin/users/?tab=1#top', LABELS)).toEqual([
      { label: 'Admin', href: '/admin' },
      { label: 'Users' },
    ]);
  });

  it('never gives the current item an href', () => {
    const crumbs = getAdminBreadcrumbs('/admin/users', LABELS);
    expect(crumbs.at(-1)?.href).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-breadcrumbs.test.ts`
Expected: FAIL — cannot resolve `@/components/admin/breadcrumbs`.

- [ ] **Step 3: Implement `src/components/admin/breadcrumbs.ts`**

Normalize, validate the `/admin` prefix with the same boundary rule as `isAdminPath`, return the fallback for unknown full paths, then map segments to labelled paths. Only labelled ancestors produce crumbs; the final crumb receives no `href`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-breadcrumbs.test.ts`
Expected: PASS.

---

### Task 6: Base UI dropdown-menu wrapper

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`
- Test: `tests/unit/components/dropdown-menu.test.tsx`

**Interfaces:**
- Produces client components: `DropdownMenu` (Root props), `DropdownMenuTrigger` (Trigger props), `DropdownMenuContent` (`side?: 'top' | 'bottom'`, `align?: 'start' | 'end'`, `sideOffset?: number`, plus Popup props), `DropdownMenuItem` (Item props), `DropdownMenuLinkItem` (LinkItem props), `DropdownMenuSeparator` (Separator props).

`DropdownMenuContent` renders a portal → positioner (`z-50`, `outline-none`) → popup with `min-w-56 rounded-xl bg-popover p-1 text-sm text-popover-foreground ring-1 ring-foreground/10`, and accepts `className`. Items share `flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom

import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

afterEach(cleanup);

it('opens the menu from its trigger', async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button">Open menu</button>} />
      <DropdownMenuContent>
        <DropdownMenuItem>First action</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

  expect(await screen.findByRole('menu')).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: 'First action' })).toBeTruthy();
});
```

If jsdom reports `ResizeObserver is not defined`, add this before the test and nothing else:

```ts
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/dropdown-menu.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/dropdown-menu`.

- [ ] **Step 3: Implement `src/components/ui/dropdown-menu.tsx`**

Follow the import/style conventions of `src/components/ui/dialog.tsx`: `'use client'`, `import { Menu as MenuPrimitive } from '@base-ui/react/menu'`, `import { cn } from 'cn'`, `data-slot` attributes, and typed props via `MenuPrimitive.*.Props`. Do not add new dependencies.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/dropdown-menu.test.tsx`
Expected: PASS.

---

### Task 7: Admin shell, sidebar, and header

**Files:**
- Create: `src/components/admin/admin-shell.tsx`
- Create: `src/components/admin/admin-sidebar.tsx`
- Create: `src/components/admin/admin-header.tsx`
- Modify: `src/components/ui/dialog.tsx` (add optional `overlayClassName` to `DialogContent`)
- Modify: `docs/superpowers/specs/2026-11-12-admin-layout-design.md` (§12 note: `dialog.tsx` gains a backward-compatible `overlayClassName` prop so the drawer can use a stronger overlay without duplicating the primitive)
- Test: `tests/unit/components/admin-shell.test.tsx`

**Interfaces:**
- Consumes: `AdminNavGroup` (Task 3), `AdminBreadcrumb` (Task 5), `Dialog`/`DialogContent`/`DialogClose`/`DialogTrigger`, `Button`, `cn`, `lucide-react`, `Link`, `usePathname`.
- Produces:
  - `export type AdminShellUser = Readonly<{ name: string; email: string }>;`
  - `AdminShell({ navigation, breadcrumbs, user, children })` — client component; no authorization.
  - `AdminSidebar({ navigation, pathname })`, `AdminHeader({ breadcrumbs, user })` — internal to the shell.
  - `DialogContent` gains `overlayClassName?: string`; default behaviour unchanged.

Structure:

```
<Dialog open={mobileOpen} onOpenChange={setMobileOpen}>   // shell state
  <AdminSidebar />        fixed w-64 aside (hidden below lg) + DialogContent drawer
  <div className="lg:pl-64">
    <AdminHeader />       sticky h-14: DialogTrigger, breadcrumbs, account menu slot
    <main id="main-content">{children}</main>
  </div>
</Dialog>
```

The shell closes the drawer on navigation with `useEffect(() => { setMobileOpen(false); }, [pathname])`. The header's mobile trigger is a `DialogTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" />}` so Base UI supplies expanded state and focus return.

Drawer `DialogContent` props: `showCloseButton={false}`, `overlayClassName="bg-black/60 backdrop-blur-sm"`, `className="top-0 left-0 h-dvh w-72 max-w-[calc(100vw-3rem)] translate-x-0 translate-y-0 gap-0 rounded-none p-0 ring-0 sm:max-w-[calc(100vw-3rem)] data-open:zoom-in-100 data-closed:zoom-out-100 data-open:slide-in-from-left-full data-closed:slide-out-to-left-full"`. Include an `sr-only` `DialogTitle` ("Admin navigation") and a first-focusable `DialogClose` button labelled "Close navigation".

Sidebar navigation: `<aside>` with brand row, `<nav aria-label="Admin">` for desktop and `<nav aria-label="Admin navigation">` inside the drawer, group label `<p>` uppercase `text-muted-foreground`, links with `aria-current="page"` when `isAdminNavItemActive`, and an entry icon map keyed by entry id (`overview` → `LayoutDashboard`, `films` style defaults for the rest) with a small neutral fallback.

Header: `<header>` sticky `top-0 z-30` `h-14` border-bottom, `bg-background/80 backdrop-blur`; breadcrumbs as `<nav aria-label="Breadcrumb"><ol>` with `ChevronRight aria-hidden` separators, ancestor `<Link>`s, and `<span aria-current="page">` for the current crumb; then the account-menu slot. The header must not render a second page title.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { pathnameState } = vi.hoisted(() => ({ pathnameState: { value: '/admin' } }));

vi.mock('next/navigation', () => ({ usePathname: () => pathnameState.value }));
vi.mock('@/workflows/auth/google-oauth', () => ({ googleSignOut: vi.fn() }));

import { AdminShell } from '@/components/admin/admin-shell';
import type { AdminNavGroup } from '@/components/admin/navigation';

const navigation: readonly AdminNavGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    entries: [
      {
        id: 'overview',
        label: 'Overview',
        href: '/admin',
        permissions: [],
        implemented: true,
      },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    entries: [
      {
        id: 'dramas',
        label: 'Dramas',
        href: '/admin/dramas',
        permissions: ['drama.read'],
        implemented: true,
      },
    ],
  },
];

const breadcrumbs = [{ label: 'Admin' }] as const;
const user = { name: 'Ada Lovelace', email: 'ada@example.com' } as const;

function renderShell() {
  return render(
    <AdminShell navigation={navigation} breadcrumbs={breadcrumbs} user={user}>
      <p>Admin content</p>
    </AdminShell>
  );
}

function isScrollLocked(): boolean {
  return (
    document.documentElement.hasAttribute('data-base-ui-scroll-locked') ||
    document.documentElement.style.overflowY === 'hidden' ||
    document.body.style.overflowY === 'hidden'
  );
}

beforeEach(() => {
  pathnameState.value = '/admin';
});

afterEach(cleanup);

describe('AdminShell', () => {
  it('renders permitted navigation and marks the active link', () => {
    renderShell();

    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dramas' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
  });

  it('renders breadcrumbs with a non-link current page', () => {
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('Admin');
    expect(current?.closest('a')).toBeNull();
  });

  it('renders the page content inside the main landmark', () => {
    renderShell();
    expect(screen.getByRole('main').textContent).toContain('Admin content');
  });

  it('opens the drawer from the mobile trigger', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Admin navigation' })).toBeTruthy();
  });

  it('closes the drawer on Escape and returns focus to the trigger', async () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('locks body scroll while open and restores it afterwards', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await screen.findByRole('dialog');

    await waitFor(() => expect(isScrollLocked()).toBe(true));

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(isScrollLocked()).toBe(false));
  });

  it('closes the drawer when the pathname changes', async () => {
    const view = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await screen.findByRole('dialog');

    pathnameState.value = '/admin/dramas';
    view.rerender(
      <AdminShell navigation={navigation} breadcrumbs={breadcrumbs} user={user}>
        <p>Admin content</p>
      </AdminShell>
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-shell.test.tsx`
Expected: FAIL — cannot resolve `@/components/admin/admin-shell`.

- [ ] **Step 3: Implement the dialog prop, sidebar, header, and shell**

Add `overlayClassName?: string` to `DialogContent`, destructure it so it is not spread onto the popup DOM, and pass it to `<DialogOverlay className={overlayClassName} />`. Then implement the three components as described above, with tokens only (`bg-card`, `bg-popover`, `text-muted-foreground`, `border-border`, `hover:bg-muted`, `focus-visible:ring-ring`).

Keep the account menu out of this task: the header renders a non-interactive identity block (initials circle plus `<span className="hidden sm:inline">{user.name}</span>`) in the account-menu slot. Task 8 replaces that block with `<AdminAccountMenu user={user} />`; do not create a stub component with the final API.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-shell.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 8: Account menu

**Files:**
- Create: `src/components/admin/admin-account-menu.tsx`
- Modify: `src/components/admin/admin-header.tsx` (render `<AdminAccountMenu user={user} />` in the header slot)
- Test: `tests/unit/components/admin-account-menu.test.tsx`

**Interfaces:**
- Consumes: `DropdownMenu*` (Task 6), `googleSignOut` from `@/workflows/auth/google-oauth`, `AdminShellUser` (Task 7), `Link`.
- Produces: `getInitials(name: string, email: string): string` and `AdminAccountMenu({ user })`.

Menu content order: name, email, separator, **Your account** → `/dashboard`, **View site** → `/`, separator, **Sign out** as a submit button inside `<form action={googleSignOut}>`. `Menu.LinkItem` uses `closeOnClick`; the sign-out form reuses the existing action and creates no second implementation.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/workflows/auth/google-oauth', () => ({ googleSignOut: vi.fn() }));

import { AdminAccountMenu, getInitials } from '@/components/admin/admin-account-menu';

afterEach(cleanup);

const user = { name: 'Ada Lovelace', email: 'ada@example.com' } as const;

it('derives initials from the name, then the email', () => {
  expect(getInitials('Ada Lovelace', 'ada@example.com')).toBe('AL');
  expect(getInitials('Ada', 'ada@example.com')).toBe('A');
  expect(getInitials('', 'ada@example.com')).toBe('A');
  expect(getInitials('', '')).toBe('?');
});

it('shows the identity and navigation actions in the menu', async () => {
  render(<AdminAccountMenu user={user} />);

  fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));

  const menu = await screen.findByRole('menu');
  expect(within(menu).getByText('Ada Lovelace')).toBeTruthy();
  expect(within(menu).getByText('ada@example.com')).toBeTruthy();

  const account = screen.getByRole('menuitem', { name: 'Your account' });
  const site = screen.getByRole('menuitem', { name: 'View site' });
  expect(account.getAttribute('href')).toBe('/dashboard');
  expect(site.getAttribute('href')).toBe('/');
});

it('submits sign-out through the existing server action', async () => {
  render(<AdminAccountMenu user={user} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));

  const signOut = await screen.findByRole('menuitem', { name: 'Sign out' });
  expect(signOut.getAttribute('type')).toBe('submit');
  expect(signOut.closest('form')).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-account-menu.test.tsx`
Expected: FAIL — cannot resolve `@/components/admin/admin-account-menu`.

- [ ] **Step 3: Implement the account menu and wire it into the header**

Trigger: circular initials avatar (`aria-hidden` on the initials) plus the name on `sm+`, with `aria-label="Open account menu"` and a `ChevronDown` icon. Use `align="end"`, `sideOffset={6}`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-account-menu.test.tsx`
Expected: PASS.

Run: `npm run lint`
Expected: PASS with no `no-extra-parens` or hook violations.

---

### Task 9: Admin route gate, layout, and overview page

**Files:**
- Create: `src/app/admin/_access.ts`
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`
- Test: `tests/unit/app/admin-page.test.tsx`

**Interfaces:**
- Consumes: `resolveActor` (authorization module), `getActiveSession`, `resolveAdminPageAccess`, `filterAdminNavigation`, `ADMIN_NAVIGATION`, `getAdminBreadcrumbs`, `buildAdminSignInUrl`, `AdminShell`.
- Produces:

```ts
export type AdminPageContext = Readonly<{
  actor: ActorContext;
  user: Readonly<{ name: string; email: string }>;
}>;

export async function requireAdminPageAccess(requestedPath: string): Promise<AdminPageContext>;
```

`_access.ts` is server-only (`import 'server-only';`), caches `resolveActor` and `getActiveSession` with React `cache`, and translates the pure decision: `anonymous` → `redirect(signInUrl)`, `forbidden` → `notFound()`. If the session disappears between the two reads, redirect to `buildAdminSignInUrl(requestedPath)`. Narrow with `if (access.status !== 'allowed') { … }` so TypeScript sees `allowed` afterwards.

- [ ] **Step 1: Write the failing page-gate test**

```tsx
// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
}));

vi.mock('@/app/admin/_access', () => ({
  requireAdminPageAccess: requireAdminPageAccessMock,
}));

import AdminOverviewPage from '@/app/admin/page';

afterEach(cleanup);

it('checks admin access itself before rendering and shows the real roles', async () => {
  requireAdminPageAccessMock.mockResolvedValue({
    actor: {
      userId: 'user-1',
      roles: ['content_manager'],
      isSuperAdmin: false,
      permissions: ['drama.read'],
    },
    user: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });

  render(await AdminOverviewPage());

  expect(requireAdminPageAccessMock).toHaveBeenCalledWith('/admin');
  expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
  expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
  expect(screen.getByText('content_manager')).toBeTruthy();
});
```

Run: `npx vitest run tests/unit/app/admin-page.test.tsx`
Expected: FAIL — cannot resolve `@/app/admin/page`.

- [ ] **Step 2: Implement `_access.ts`, `layout.tsx`, and `page.tsx`**

`layout.tsx` (Server Component, `export const dynamic = 'force-dynamic'`):

```tsx
const { actor, user } = await requireAdminPageAccess('/admin');
const navigation = filterAdminNavigation(ADMIN_NAVIGATION, actor);
const breadcrumbs = getAdminBreadcrumbs('/admin');
return (
  <AdminShell navigation={navigation} breadcrumbs={breadcrumbs} user={user}>
    {children}
  </AdminShell>
);
```

`page.tsx` (Server Component): call `requireAdminPageAccess('/admin')` again, then render `<h1>Overview</h1>`, a line "Signed in as {user.name}.", and a labelled "Your roles" card listing `Super Admin` when `actor.isSuperAdmin`, otherwise the `actor.roles` values, or "No roles assigned" when empty. Real actor data only — no metrics, charts, or invented destinations.

- [ ] **Step 3: Run the page test, typecheck, and lint**

Run: `npx vitest run tests/unit/app/admin-page.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Confirm the page is not reachable without a session**

Run: `npm run dev` in the background, then in another shell: `curl -i http://localhost:3000/admin` (PowerShell: `curl.exe -i http://localhost:3000/admin`).
Expected: `307` (or `303`) with `location: /auth/signin?callbackUrl=%2Fadmin`.

Stop the dev server afterwards.

---

### Task 10: Playwright coverage for anonymous admin access

**Files:**
- Create: `tests/e2e/admin-access.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test';

test.describe('admin access', () => {
  test('redirects anonymous visitors to sign in with the admin callback', async ({ page }) => {
    const response = await page.goto('/admin');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=%2Fadmin$/);
    await expect(
      page.getByRole('heading', { name: 'Sign in to DramaScan' })
    ).toBeVisible();
    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue('/admin');
  });

  test('never forwards an external callback URL to the sign-in form', async ({ page }) => {
    await page.goto('/auth/signin?callbackUrl=https%3A%2F%2Fevil.example%2Fadmin');

    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue('/dashboard');
  });
});
```

- [ ] **Step 2: Run only the new spec**

Run: `npx playwright test tests/e2e/admin-access.spec.ts`
Expected: PASS, 2 tests. The suite starts its own dev server on port 3000; stop any manually started server first.

- [ ] **Step 3: Run the whole E2E suite**

Run: `npm run test:e2e`
Expected: PASS, all specs. If a cold dev compile causes a navigation timeout that passes on rerun, record it separately rather than treating it as a regression.

---

### Task 11: Documentation, full verification, and the single commit

**Files:**
- Create: `docs/development/admin-shell.md`
- Modify: `docs/README.md` (add the admin shell doc link)
- Modify: `docs/PROJECT_STATUS.md` (Prompt 049 row, current prompt, verification)
- Modify: `docs/CHANGELOG.md` (`0.4.9` entry)

- [ ] **Step 1: Write `docs/development/admin-shell.md`**

Cover: file map; the server-gate → pure-decision → client-shell flow; the permission mapping table from Task 3; how to expose a future entry (flip `implemented`, keep the key); the derived `ADMIN_AREA_PERMISSIONS` rule and its limitation (a read permission is enough to enter the admin area); callback sanitizing and the `/dashboard` fallback; breadcrumb rules and the fact that only `/admin` is wired while the helper supports nested paths; responsive behaviour; account menu; test coverage; and the explicit limitation that authenticated admin/non-admin browser flows are covered only by unit tests because local Google OAuth credentials are placeholders.

- [ ] **Step 2: Update the indexes and changelog**

`docs/README.md`: add `- [Admin Shell](development/admin-shell.md)` after the confirmation dialogs entry.

`docs/PROJECT_STATUS.md`: add the Prompt 049 row with the changed files and actual test counts; update the current-prompt/verification section.

`docs/CHANGELOG.md`: add `## [0.4.9] - 2026-11-12` with the prompt number, behaviour, changed files, and verification results.

- [ ] **Step 3: Run the full verification gate**

Run, in order, and record the actual output:

```text
npm run typecheck
npm run lint
npm test
npm run test:integration
node "C:\Users\User\AppData\Local\Temp\opencode\dramascan-build.mjs"
npm run test:e2e
```

Expected: every command passes. Known pre-existing build warnings about the main database lacking `information_pages.position` are reported separately, not treated as new failures.

- [ ] **Step 4: Review the diff for secrets and scope**

Run: `git status` and `git diff --check`.
Expected: only the files listed in this plan, no `.env*`, no `test-results/`, no `.next/`, no debug code.

- [ ] **Step 5: Create the single commit**

```bash
git add src/app/admin src/app/auth/signin/page.tsx src/components/admin src/components/ui/dropdown-menu.tsx src/components/ui/dialog.tsx src/lib/redirects.ts src/workflows/auth/google-oauth.ts tests/unit tests/e2e/admin-access.spec.ts docs
git commit -m "feat: build the admin layout (Prompt 049)"
```

Do **not** push. Report the commit hash, verification results, and the unverified browser scenarios, then request explicit approval to push.

---

## Plan Self-Review

- **Spec coverage:** shell and responsive behaviour → Tasks 7–9; permission-aware nav → Task 3; server gate → Tasks 4 and 9; callback preservation → Tasks 1–2 and 10; breadcrumbs → Tasks 5 and 7; account menu → Task 8; tests/docs/commit → Tasks 10–11. No future admin pages, tables, or schema changes.
- **Deliberate deviations from the design, both approved in principle:** `_access.ts` is the shared server adapter, and `ui/dialog.tsx` gains a backward-compatible `overlayClassName` prop; the design doc is updated in Task 7.
- **Ordering:** every task's dependencies appear earlier; no per-task commits, because Prompt 049 requires exactly one.
- **Type consistency:** `AdminNavEntry`/`AdminNavGroup` (Task 3) feed the shell (Task 7); `AdminBreadcrumb` (Task 5) feeds the header (Task 7); `AdminShellUser` (Task 7) feeds the account menu (Task 8); `AdminPageContext` (Task 9) feeds layout and page.
- **Unchanged public surface:** existing admin REST handlers, `requireAdmin`, `googleSignOut`, and all current UI primitives except the additive `overlayClassName` prop.
