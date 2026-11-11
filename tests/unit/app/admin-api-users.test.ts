import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { resolveActorMock, authorizeMock, deactivateMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  authorizeMock: vi.fn(),
  deactivateMock: vi.fn(),
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

vi.mock('@/workflows/admin/users', () => ({
  authorizeUserAsAdmin: authorizeMock,
  deactivateAdminUser: deactivateMock,
  reactivateAdminUser: vi.fn(),
  inspectUserRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { GET } from '@/app/admin/api/users/route';

const anonymous = { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
const adminManager = {
  userId: 'u1',
  roles: ['admin'],
  isSuperAdmin: false,
  permissions: ['admin.manage'],
};
const superAdmin = { userId: 'u2', roles: ['super_admin'], isSuperAdmin: true, permissions: [] };

function request(query = '') {
  return new Request(`http://localhost:3000/admin/api/users${query}`);
}

beforeEach(() => {
  resolveActorMock.mockReset();
  authorizeMock.mockReset();
  deactivateMock.mockReset();
});

describe('GET /admin/api/users', () => {
  it('returns 401 for anonymous actors on authorize-admin', async () => {
    resolveActorMock.mockResolvedValue(anonymous);

    const response = await GET(request('?action=authorize-admin'));

    expect(response.status).toBe(401);
  });

  it('returns 403 for a non-Super-Admin holding admin.manage on authorize-admin', async () => {
    resolveActorMock.mockResolvedValue(adminManager);

    const response = await GET(request('?action=authorize-admin'));

    expect(response.status).toBe(403);
    expect(authorizeMock).not.toHaveBeenCalled();
  });

  it('lets a Super Admin authorize an administrator', async () => {
    resolveActorMock.mockResolvedValue(superAdmin);
    authorizeMock.mockResolvedValue({ success: true });

    await expect(GET(request('?action=authorize-admin'))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(authorizeMock).toHaveBeenCalled();
  });

  it('keeps deactivate-admin available to a permitted non-Super-Admin', async () => {
    resolveActorMock.mockResolvedValue(adminManager);
    deactivateMock.mockResolvedValue({ success: true });

    await expect(GET(request('?action=deactivate-admin'))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(deactivateMock).toHaveBeenCalled();
  });

  it('returns 401 for anonymous actors on deactivate-admin', async () => {
    resolveActorMock.mockResolvedValue(anonymous);

    const response = await GET(request('?action=deactivate-admin'));

    expect(response.status).toBe(401);
  });
});
