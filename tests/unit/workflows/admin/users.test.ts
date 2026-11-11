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
  authorizeUserAsAdmin,
  deactivateAdminUser,
  inspectUserRole,
  reactivateAdminUser,
} from '@/workflows/admin/users';

const anonymous = { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
const adminManager = {
  userId: 'u1',
  roles: ['admin'],
  isSuperAdmin: false,
  permissions: ['admin.manage'] as const,
};
const superAdmin = { userId: 'u2', roles: ['super_admin'], isSuperAdmin: true, permissions: [] };

beforeEach(() => {
  resolveActorMock.mockReset();
});

describe('users workflow authorization', () => {
  it('denies authorizeUserAsAdmin to a non-Super-Admin with admin.manage', async () => {
    resolveActorMock.mockResolvedValue(adminManager);

    await expect(authorizeUserAsAdmin()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('denies authorizeUserAsAdmin to anonymous actors', async () => {
    resolveActorMock.mockResolvedValue(anonymous);

    await expect(authorizeUserAsAdmin()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('allows authorizeUserAsAdmin for a Super Admin', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);

    await expect(authorizeUserAsAdmin()).resolves.toMatchObject({ success: true });
  });

  it.each([
    ['deactivateAdminUser', () => deactivateAdminUser()],
    ['reactivateAdminUser', () => reactivateAdminUser()],
    ['inspectUserRole', () => inspectUserRole()],
  ] as const)('%s keeps working for a permitted non-Super-Admin', async (_name, call) => {
    resolveActorMock.mockResolvedValue(adminManager);

    await expect(call()).resolves.toMatchObject({ success: true });
  });
});
