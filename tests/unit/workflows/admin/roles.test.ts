import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, AuthorizationError } from '@/platform/errors';

vi.mock('server-only', () => ({}));

const { resolveActorMock } = vi.hoisted(() => ({ resolveActorMock: vi.fn() }));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...permissions, ...guards, resolveActor: resolveActorMock };
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
