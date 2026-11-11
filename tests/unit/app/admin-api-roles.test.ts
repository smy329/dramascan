import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { resolveActorMock, createRoleMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  createRoleMock: vi.fn(),
}));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...permissions, ...guards, resolveActor: resolveActorMock };
});

vi.mock('@/workflows/admin/roles', () => ({
  createRole: createRoleMock,
  editRole: vi.fn(),
  assignPermission: vi.fn(),
  revokePermission: vi.fn(),
  getRolePermissions: vi.fn(),
  validateSuperAdminAccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { GET } from '@/app/admin/api/roles/route';

const anonymous = { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
const adminManager = {
  userId: 'u1',
  roles: ['admin'],
  isSuperAdmin: false,
  permissions: ['admin.manage'],
};
const superAdmin = { userId: 'u2', roles: ['super_admin'], isSuperAdmin: true, permissions: [] };

function request(query = '') {
  return new Request(`http://localhost:3000/admin/api/roles${query}`);
}

beforeEach(() => {
  resolveActorMock.mockReset();
  createRoleMock.mockReset();
});

describe('GET /admin/api/roles', () => {
  it('returns 401 for anonymous actors', async () => {
    resolveActorMock.mockResolvedValue(anonymous);

    const response = await GET(request('?action=create-role'));

    expect(response.status).toBe(401);
  });

  it('returns 403 for a non-Super-Admin holding admin.manage', async () => {
    resolveActorMock.mockResolvedValue(adminManager);

    const response = await GET(request('?action=create-role'));

    expect(response.status).toBe(403);
    expect(createRoleMock).not.toHaveBeenCalled();
  });

  it('lets a Super Admin reach the action dispatch', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);

    const response = await GET(request());

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Missing action');
  });

  it('runs the role action for a Super Admin', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);
    createRoleMock.mockResolvedValue({ success: true, role: { id: 'r1', name: 'editors' } });

    await expect(GET(request('?action=create-role&name=editors'))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(createRoleMock).toHaveBeenCalled();
  });
});
