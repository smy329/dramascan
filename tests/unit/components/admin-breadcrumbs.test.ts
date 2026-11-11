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
    expect(ADMIN_ROUTE_LABELS['/admin']).toBe('Admin');
  });

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
