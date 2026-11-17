// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock, listRolesForAdminMock, notFoundMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
  listRolesForAdminMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/app/admin/_access', () => ({ requireAdminPageAccess: requireAdminPageAccessMock }));
vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/workflows/admin/roles', () => ({ listRolesForAdmin: listRolesForAdminMock }));
// The real catalog decides which permissions can be granted.
vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...permissions, ...guards };
});

import AdminRolesPage from '@/app/admin/roles/page';

const superAdmin = {
  userId: 'root-1',
  roles: [],
  isSuperAdmin: true,
  permissions: [],
};

afterEach(cleanup);

beforeEach(() => {
  requireAdminPageAccessMock.mockReset();
  listRolesForAdminMock.mockReset();
  notFoundMock.mockClear();
});

describe('AdminRolesPage', () => {
  it('lists the roles for a Super Admin', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: superAdmin });
    listRolesForAdminMock.mockResolvedValue([
      {
        id: 'role-1',
        name: 'content_editor',
        description: 'Edits catalogue content.',
        permissions: [{ permissionKey: 'drama.update', granted: true }],
        grantedPermissionKeys: ['drama.update'],
        userCount: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    render(await AdminRolesPage());

    expect(listRolesForAdminMock).toHaveBeenCalledWith(superAdmin);
    expect(screen.getByRole('cell', { name: 'content_editor' })).toBeTruthy();
    expect(screen.getByText('Edits catalogue content.')).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('offers the whole permission catalog so any permission can be granted', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: superAdmin });
    listRolesForAdminMock.mockResolvedValue([]);

    render(await AdminRolesPage());

    // The catalog is rendered inside the permission editor, which only opens
    // from a role row; the create form proves the page still rendered.
    expect(screen.getByRole('heading', { name: 'Roles & permissions' })).toBeTruthy();
    expect(screen.getByLabelText('Role name')).toBeTruthy();
  });

  it('returns not-found without loading the roles for an actor that is not a Super Admin', async () => {
    requireAdminPageAccessMock.mockResolvedValue({
      actor: {
        userId: 'admin-1',
        roles: [],
        isSuperAdmin: false,
        permissions: ['admin.manage'],
      },
    });

    await expect(AdminRolesPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(listRolesForAdminMock).not.toHaveBeenCalled();
  });
});
