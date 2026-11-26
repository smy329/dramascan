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
  invalidateUserSessionsMock,
  listRolesMock,
  listUserRoleAssignmentsMock,
  notifyAccountSecurityMock,
  revokeUserRoleMock,
  setRolePermissionsMock,
  setUserAccountActiveMock,
  updateRoleMock,
} = vi.hoisted(() => ({
  assignUserRoleMock: vi.fn(),
  createRoleMock: vi.fn(),
  deleteRoleMock: vi.fn(),
  getUserAccountMock: vi.fn(),
  invalidateUserSessionsMock: vi.fn(),
  listRolesMock: vi.fn(),
  listUserRoleAssignmentsMock: vi.fn(),
  notifyAccountSecurityMock: vi.fn(),
  revokeUserRoleMock: vi.fn(),
  setRolePermissionsMock: vi.fn(),
  setUserAccountActiveMock: vi.fn(),
  updateRoleMock: vi.fn(),
}));

// The notifications module is server-only; the workflow under test is not a
// Client Component, so the marker is neutralised for the unit run.
vi.mock('server-only', () => ({}));

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
    invalidateUserSessions: invalidateUserSessionsMock,
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

vi.mock('@/modules/notifications', () => ({
  notifyAccountSecurity: notifyAccountSecurityMock,
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
  terminateUserSessionsForAdmin,
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

  // The account holds no role by default: a role assignment is a change, and a
  // change is what the account owner is told about.
  listUserRoleAssignmentsMock.mockResolvedValue([]);

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

  it('tells the account owner when a role is assigned', async () => {
    assignUserRoleMock.mockResolvedValue([
      {
        roleId: 'role-1',
        roleName: 'Content Manager',
        assignedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await assignUserRoleForAdmin(superAdmin, 'user-1', 'role-1');

    expect(notifyAccountSecurityMock).toHaveBeenCalledTimes(1);
    expect(notifyAccountSecurityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        title: expect.stringContaining('role'),
        content: expect.stringContaining('Content Manager'),
      })
    );
  });

  it('does not tell the account owner when the role was already assigned', async () => {
    listUserRoleAssignmentsMock.mockResolvedValue([
      {
        roleId: 'role-1',
        roleName: 'Content Manager',
        assignedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    assignUserRoleMock.mockResolvedValue([
      {
        roleId: 'role-1',
        roleName: 'Content Manager',
        assignedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await assignUserRoleForAdmin(superAdmin, 'user-1', 'role-1');

    expect(assignUserRoleMock).toHaveBeenCalledWith(superAdmin, 'user-1', 'role-1');
    expect(notifyAccountSecurityMock).not.toHaveBeenCalled();
  });

  it('tells the account owner when a role is removed', async () => {
    listUserRoleAssignmentsMock.mockResolvedValue([
      {
        roleId: 'role-1',
        roleName: 'Content Manager',
        assignedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    revokeUserRoleMock.mockResolvedValue([]);

    await revokeUserRoleForAdmin(superAdmin, 'user-1', 'role-1');

    expect(notifyAccountSecurityMock).toHaveBeenCalledTimes(1);
    expect(notifyAccountSecurityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        title: expect.stringContaining('role'),
        content: expect.stringContaining('Content Manager'),
      })
    );
  });
});

describe('session termination workflow', () => {
  it('rejects an actor that is not a Super Admin', async () => {
    await expect(
      terminateUserSessionsForAdmin(adminManager, 'user-1')
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(invalidateUserSessionsMock).not.toHaveBeenCalled();
  });

  it('terminates the sessions and tells the account owner', async () => {
    invalidateUserSessionsMock.mockResolvedValue(undefined);

    await terminateUserSessionsForAdmin(superAdmin, 'user-1');

    expect(invalidateUserSessionsMock).toHaveBeenCalledWith('user-1', 'super-1');
    expect(notifyAccountSecurityMock).toHaveBeenCalledTimes(1);
    expect(notifyAccountSecurityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' })
    );
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

  it('tells the account owner when the account is deactivated', async () => {
    setUserAccountActiveMock.mockResolvedValue({
      id: 'user-1',
      isActive: false,
    });

    await setUserAccountActiveForAdmin(adminManager, 'user-1', false);

    expect(notifyAccountSecurityMock).toHaveBeenCalledTimes(1);
    expect(notifyAccountSecurityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        title: expect.stringContaining('deactivated'),
      })
    );
  });

  it('tells the account owner when the account is reactivated', async () => {
    // The account was deactivated: a reactivation is a change, and a change is
    // what the account owner is told about.
    getUserAccountMock.mockResolvedValue({
      id: 'user-1',
      name: 'Target User',
      email: 'target@example.com',
      isActive: false,
      isSuperAdmin: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
    });
    setUserAccountActiveMock.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });

    await setUserAccountActiveForAdmin(adminManager, 'user-1', true);

    expect(notifyAccountSecurityMock).toHaveBeenCalledTimes(1);
    expect(notifyAccountSecurityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        title: expect.stringContaining('reactivated'),
      })
    );
  });

  it('does not tell the account owner when the account status did not change', async () => {
    setUserAccountActiveMock.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });

    await setUserAccountActiveForAdmin(adminManager, 'user-1', true);

    expect(setUserAccountActiveMock).toHaveBeenCalledWith('user-1', true);
    expect(notifyAccountSecurityMock).not.toHaveBeenCalled();
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
