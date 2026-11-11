import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTE_LABELS, getAdminBreadcrumbs } from '@/components/admin/breadcrumbs';

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
