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

    expect(
      filterAdminNavigation(groups, actor(['drama.read'])).map((group) =>
        group.entries.map((entry) => entry.id)
      )
    ).toEqual([['dramas']]);
    expect(filterAdminNavigation(groups, actor(['review.manage'])).map((group) => group.id)).toEqual([
      'moderation',
    ]);
    expect(filterAdminNavigation(groups, actor(['analytics.read']))).toEqual([]);
  });

  it('keeps unimplemented entries hidden even when permitted', () => {
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
            implemented: false,
          },
        ],
      },
    ];

    expect(filterAdminNavigation(groups, actor(['drama.read']))).toEqual([]);
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
