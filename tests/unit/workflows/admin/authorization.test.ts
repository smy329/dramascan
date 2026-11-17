import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError, AuthorizationError, NotFoundError } from '@/platform/errors';

/**
 * Unit coverage for the actor-first administration workflows.
 *
 * The workflows no longer resolve the actor themselves: the caller resolves it
 * server-side and passes it as the first argument, so a client can never
 * assert who it is. These tests pin that contract at the unit level:
 *
 * - The guard runs before the module service is reached.
 * - The actor is forwarded to the service unchanged.
 * - A Super Admin account can only be changed by a Super Admin.
 *
 * The real guard implementations are used; only the module services are
 * mocked, so a guard change cannot be hidden by a test double.
 */

const {
  assignUserRoleMock,
  createRoleMock,
  deleteRoleMock,
  getUserAccountMock,
  listRolesMock,
  listUserRoleAssignmentsMock,
  revokeUserRoleMock,
  setRolePermissionsMock,
  setUserAccountActiveMock,
  updateRoleMock,
} = vi.hoisted(() => ({
  assignUserRoleMock: vi.fn(),
  createRoleMock: vi.fn(),
  deleteRoleMock: vi.fn(),
  getUserAccountMock: vi.fn(),
  listRolesMock: vi.fn(),
  listUserRoleAssignmentsMock: vi.fn(),
  revokeUserRoleMock: vi.fn(),
  setRolePermissionsMock: vi.fn(),
  setUserAccountActiveMock: vi.fn(),
  updateRoleMock: vi.fn(),
}));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );

  return {
    ...guards,
    ...permissions,
    assignUserRole: assignUserRoleMock,
    createRole: createRoleMock,
    deleteRole: deleteRoleMock,
    listRoles: listRolesMock,
    listUserRoleAssignments: listUserRoleAssignmentsMock,
    revokeUserRole: revokeUserRoleMock,
    setRolePermissions: setRolePermissionsMock,
    updateRole: updateRoleMock,
  };
});

vi.mock('@/modules/auth', () => ({
  getUserAccount: getUserAccountMock,
  setUserAccountActive: setUserAccountActiveMock,
}));

import {
  createRoleForAdmin,
  deleteRoleForAdmin,
  listRolesForAdmin,
  setRolePermissionsForAdmin,
  updateRoleForAdmin,
} from '@/workflows/admin/roles';
import {
  assignUserRoleForAdmin,
  listUserRolesForAdmin,
  revokeUserRoleForAdmin,
  setUserAccountActiveForAdmin,
} from '@/workflows/admin/users';
import type { ActorContext } from '@/modules/authorization/actors';

const anonymous: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};
const superAdmin: ActorContext = {
  userId: 'super-1',
  roles: [],
  isSuperAdmin: true,
  permissions: [],
};
const adminManager: ActorContext = {
  userId: 'admin-1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['admin.manage'],
};
const userReader: ActorContext = {
  userId: 'reader-1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['user.read'],
};

beforeEach(() => {
  vi.clearAllMocks();

  getUserAccountMock.mockResolvedValue({
    id: 'user-1',
    name: 'Target User',
    email: 'target@example.com',
    isActive: true,
    isSuperAdmin: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  });
});

describe('role workflows', () => {
  it.each([
    ['listRolesForAdmin', () => listRolesForAdmin(anonymous)],
    ['createRoleForAdmin', () => createRoleForAdmin(anonymous, { name: 'editor' })],
    ['updateRoleForAdmin', () => updateRoleForAdmin(anonymous, 'role-1', { name: 'editor' })],
    ['deleteRoleForAdmin', () => deleteRoleForAdmin(anonymous, 'role-1')],
    ['setRolePermissionsForAdmin', () => setRolePermissionsForAdmin(anonymous, 'role-1', [])],
  ])('%s rejects an anonymous actor', async (_name, invoke) => {
    await expect(invoke()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it.each([
    ['listRolesForAdmin', () => listRolesForAdmin(adminManager)],
    ['createRoleForAdmin', () => createRoleForAdmin(adminManager, { name: 'editor' })],
    ['updateRoleForAdmin', () => updateRoleForAdmin(adminManager, 'role-1', { name: 'editor' })],
    ['deleteRoleForAdmin', () => deleteRoleForAdmin(adminManager, 'role-1')],
    ['setRolePermissionsForAdmin', () => setRolePermissionsForAdmin(adminManager, 'role-1', [])],
  ])('%s rejects an actor that only holds admin.manage', async (_name, invoke) => {
    await expect(invoke()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('forwards the actor to the role service unchanged', async () => {
    listRolesMock.mockResolvedValue([]);

    await listRolesForAdmin(superAdmin);

    expect(listRolesMock).toHaveBeenCalledWith(superAdmin);
  });

  it('forwards the actor and the input to the create service', async () => {
    createRoleMock.mockResolvedValue({ id: 'role-1' });

    await createRoleForAdmin(superAdmin, { name: 'editor' });

    expect(createRoleMock).toHaveBeenCalledWith(superAdmin, { name: 'editor' });
  });

  it('forwards the role id to the delete service', async () => {
    deleteRoleMock.mockResolvedValue(undefined);

    await deleteRoleForAdmin(superAdmin, 'role-1');

    expect(deleteRoleMock).toHaveBeenCalledWith(superAdmin, 'role-1');
  });

  it('forwards the permission keys to the permission service', async () => {
    setRolePermissionsMock.mockResolvedValue({ id: 'role-1' });

    await setRolePermissionsForAdmin(superAdmin, 'role-1', ['drama.read']);

    expect(setRolePermissionsMock).toHaveBeenCalledWith(superAdmin, 'role-1', ['drama.read']);
  });

  it('forwards the actor and the role id to the update service', async () => {
    updateRoleMock.mockResolvedValue({ id: 'role-1' });

    await updateRoleForAdmin(superAdmin, 'role-1', { name: 'editor' });

    expect(updateRoleMock).toHaveBeenCalledWith(superAdmin, 'role-1', { name: 'editor' });
  });
});

describe('user role workflows', () => {
  it('rejects an anonymous actor', async () => {
    await expect(listUserRolesForAdmin(anonymous, 'user-1')).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });

  it('rejects an actor that only holds user.read', async () => {
    await expect(listUserRolesForAdmin(userReader, 'user-1')).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it('allows an admin.manage holder to inspect the assignments', async () => {
    listUserRoleAssignmentsMock.mockResolvedValue([]);

    await listUserRolesForAdmin(adminManager, 'user-1');

    expect(listUserRoleAssignmentsMock).toHaveBeenCalledWith(adminManager, 'user-1');
  });

  it('refuses to assign a role for an actor that is not a Super Admin', async () => {
    await expect(
      assignUserRoleForAdmin(adminManager, 'user-1', 'role-1')
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(assignUserRoleMock).not.toHaveBeenCalled();
  });

  it('refuses to revoke a role for an actor that is not a Super Admin', async () => {
    await expect(
      revokeUserRoleForAdmin(adminManager, 'user-1', 'role-1')
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(revokeUserRoleMock).not.toHaveBeenCalled();
  });

  it('assigns a role for a Super Admin', async () => {
    assignUserRoleMock.mockResolvedValue([]);

    await assignUserRoleForAdmin(superAdmin, 'user-1', 'role-1');

    expect(assignUserRoleMock).toHaveBeenCalledWith(superAdmin, 'user-1', 'role-1');
  });

  it('revokes a role for a Super Admin', async () => {
    revokeUserRoleMock.mockResolvedValue([]);

    await revokeUserRoleForAdmin(superAdmin, 'user-1', 'role-1');

    expect(revokeUserRoleMock).toHaveBeenCalledWith(superAdmin, 'user-1', 'role-1');
  });
});

describe('account status workflow', () => {
  it('rejects an anonymous actor', async () => {
    await expect(
      setUserAccountActiveForAdmin(anonymous, 'user-1', false)
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an actor without admin.manage', async () => {
    await expect(
      setUserAccountActiveForAdmin(userReader, 'user-1', false)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('reports an unknown account as not found', async () => {
    getUserAccountMock.mockResolvedValue(null);

    await expect(
      setUserAccountActiveForAdmin(adminManager, 'missing-user', false)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deactivates an ordinary account for an admin.manage holder', async () => {
    setUserAccountActiveMock.mockResolvedValue({
      id: 'user-1',
      isActive: false,
    });

    await setUserAccountActiveForAdmin(adminManager, 'user-1', false);

    expect(setUserAccountActiveMock).toHaveBeenCalledWith('user-1', false);
  });

  it('refuses to change a Super Admin account for a non-Super-Admin', async () => {
    getUserAccountMock.mockResolvedValue({
      id: 'root-1',
      isActive: true,
      isSuperAdmin: true,
    });

    await expect(
      setUserAccountActiveForAdmin(adminManager, 'root-1', false)
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(setUserAccountActiveMock).not.toHaveBeenCalled();
  });

  it('changes a Super Admin account for a Super Admin', async () => {
    getUserAccountMock.mockResolvedValue({
      id: 'root-1',
      isActive: true,
      isSuperAdmin: true,
    });
    setUserAccountActiveMock.mockResolvedValue({
      id: 'root-1',
      isActive: false,
    });

    await setUserAccountActiveForAdmin(superAdmin, 'root-1', false);

    expect(setUserAccountActiveMock).toHaveBeenCalledWith('root-1', false);
  });
});
