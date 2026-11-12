/**
 * Central admin navigation model.
 *
 * This module is the single source of truth for the administration sidebar.
 * Every planned entry is declared here with its canonical permission keys and
 * an explicit `implemented` flag. Only entries whose route exists AND whose
 * permissions the actor holds are rendered.
 *
 * Navigation visibility is never authorization. The admin layout uses this
 * model to decide what to show; operations keep their own server-side guards.
 */

import type { ActorContext } from '@/modules/authorization/actors';
import { hasPermission } from '@/modules/authorization/guards';
import type { PermissionKey } from '@/modules/authorization/permissions';

export type AdminNavEntry = Readonly<{
  id: string;
  label: string;
  href: string;
  /** Any-of permissions. Empty means "any actor with admin-area access". */
  permissions: readonly PermissionKey[];
  implemented: boolean;
  /**
   * Super Admin-only surfaces are hidden from every actor without the
   * authoritative `isSuperAdmin` flag, regardless of permissions.
   */
  superAdminOnly?: boolean;
}>;

export type AdminNavGroup = Readonly<{
  id: string;
  label: string;
  entries: readonly AdminNavEntry[];
}>;

export const ADMIN_NAVIGATION: readonly AdminNavGroup[] = [
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
        implemented: false,
      },
      {
        id: 'movies',
        label: 'Movies',
        href: '/admin/movies',
        permissions: ['movie.read'],
        implemented: false,
      },
      {
        id: 'episodes',
        label: 'Episodes',
        href: '/admin/episodes',
        permissions: ['episode.read'],
        implemented: false,
      },
      {
        id: 'categories',
        label: 'Categories',
        href: '/admin/categories',
        permissions: ['category.read'],
        implemented: false,
      },
      {
        id: 'platforms',
        label: 'Platforms',
        href: '/admin/platforms',
        permissions: ['platform.read'],
        implemented: false,
      },
    ],
  },
  {
    id: 'moderation',
    label: 'Moderation',
    entries: [
      {
        id: 'reports',
        label: 'Reports',
        href: '/admin/reports',
        permissions: ['review.read', 'review.manage'],
        implemented: false,
      },
      {
        id: 'reviews',
        label: 'Reviews',
        href: '/admin/reviews',
        permissions: ['review.read', 'review.manage'],
        implemented: false,
      },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    entries: [
      {
        id: 'users',
        label: 'Users',
        href: '/admin/users',
        permissions: ['user.read', 'user.manage'],
        implemented: true,
      },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    entries: [
      {
        id: 'analytics',
        label: 'Analytics',
        href: '/admin/analytics',
        permissions: ['analytics.read'],
        implemented: false,
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    entries: [
      {
        id: 'notifications',
        label: 'Notifications',
        href: '/admin/notifications',
        permissions: ['admin.manage'],
        implemented: false,
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    entries: [
      {
        id: 'settings',
        label: 'Settings',
        href: '/admin/settings',
        permissions: ['settings.read', 'settings.manage', 'admin.manage'],
        implemented: false,
        superAdminOnly: true,
      },
      {
        id: 'roles',
        label: 'Roles & permissions',
        href: '/admin/roles',
        permissions: ['admin.manage'],
        implemented: false,
        superAdminOnly: true,
      },
      {
        id: 'information-pages',
        label: 'Information pages',
        href: '/admin/information-pages',
        permissions: ['settings.manage', 'admin.manage'],
        implemented: false,
      },
    ],
  },
];

/**
 * Union of every permission that grants access to a non-Super-Admin-only admin
 * section. Derived from the navigation model so the shell gate cannot drift
 * from the entries. Permissions that exist only on a Super Admin-only entry
 * are excluded: holding one must not open the admin shell.
 */
export const ADMIN_AREA_PERMISSIONS: readonly PermissionKey[] = Array.from(
  new Set(
    ADMIN_NAVIGATION.flatMap((group) => group.entries)
      .filter((entry) => entry.superAdminOnly !== true)
      .flatMap((entry) => entry.permissions)
  )
);

/**
 * May this actor enter the admin area at all? Anonymous actors never qualify,
 * even if a malformed actor claims the Super Admin flag.
 */
export function hasAdminAreaAccess(actor: ActorContext): boolean {
  if (actor.userId === null) {
    return false;
  }
  if (actor.isSuperAdmin) {
    return true;
  }
  return ADMIN_AREA_PERMISSIONS.some((permission) => hasPermission(actor, permission));
}

/**
 * Keep only entries that are implemented and permitted, then drop empty
 * groups. The result is safe to serialize to the client shell.
 */
export function filterAdminNavigation(
  groups: readonly AdminNavGroup[],
  actor: ActorContext
): readonly AdminNavGroup[] {
  const areaAccess = hasAdminAreaAccess(actor);

  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => isEntryVisible(entry, actor, areaAccess)),
    }))
    .filter((group) => group.entries.length > 0);
}

function isEntryVisible(
  entry: AdminNavEntry,
  actor: ActorContext,
  areaAccess: boolean
): boolean {
  if (!entry.implemented) {
    return false;
  }
  if (entry.superAdminOnly === true && !actor.isSuperAdmin) {
    return false;
  }
  if (entry.permissions.length === 0) {
    return areaAccess;
  }
  return entry.permissions.some((permission) => hasPermission(actor, permission));
}

/** `/admin` matches exactly; other sections match themselves and descendants. */
export function isAdminNavItemActive(pathname: string, href: string): boolean {
  if (href === '/admin') {
    return pathname === '/admin';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
