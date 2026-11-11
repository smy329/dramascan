import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '@/platform/errors';

const { resolveActorMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
}));

vi.mock('@/modules/authorization', async () => {
  const guards = await import('@/modules/authorization/guards');
  const permissions = await import('@/modules/authorization/permissions');
  return {
    resolveActor: resolveActorMock,
    requirePermission: guards.requirePermission,
    requireAnyPermission: guards.requireAnyPermission,
    requireUser: guards.requireUser,
    requireAdmin: guards.requireAdmin,
    requireSuperAdmin: guards.requireSuperAdmin,
    toPermissionKey: permissions.toPermissionKey,
  };
});

import {
  assignPermission,
  createRole,
  editRole,
  getRolePermissions,
  revokePermission,
  validateSuperAdminAccess,
} from '@/workflows/admin/roles';
import {
  authorizeUserAsAdmin,
  deactivateAdminUser,
  inspectUserRole,
  reactivateAdminUser,
} from '@/workflows/admin/users';

const anonymous = { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
const superAdmin = {
  userId: 'super-1',
  roles: ['super_admin'],
  isSuperAdmin: true,
  permissions: [],
};

beforeEach(() => {
  resolveActorMock.mockReset();
});

describe('role management workflows resolve the actor server-side', () => {
  it.each([
    ['createRole', () => createRole('editor', 'Editor')],
    ['editRole', () => editRole('role-1', 'editor')],
    ['assignPermission', () => assignPermission('role-1', 'read', 'drama')],
    ['revokePermission', () => revokePermission('role-1', 'read', 'drama')],
    ['getRolePermissions', () => getRolePermissions('role-1')],
    ['validateSuperAdminAccess', () => validateSuperAdminAccess('role-1', 'drama', 'read')],
  ])('%s rejects anonymous callers with AuthenticationError', async (_name, invoke) => {
    resolveActorMock.mockResolvedValue(anonymous);

    await expect(invoke()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('allows a resolved Super Admin to create a role', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);

    await expect(createRole('editor', 'Editor')).resolves.toMatchObject({ success: true });
  });
});

describe('administrator account workflows resolve the actor server-side', () => {
  it.each([
    ['authorizeUserAsAdmin', () => authorizeUserAsAdmin()],
    ['deactivateAdminUser', () => deactivateAdminUser()],
    ['reactivateAdminUser', () => reactivateAdminUser()],
    ['inspectUserRole', () => inspectUserRole()],
  ])('%s rejects anonymous callers with AuthenticationError', async (_name, invoke) => {
    resolveActorMock.mockResolvedValue(anonymous);

    await expect(invoke()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('allows a resolved Super Admin to inspect a role', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);

    await expect(inspectUserRole()).resolves.toMatchObject({ success: true });
  });
});
