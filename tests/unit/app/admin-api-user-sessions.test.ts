import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { resolveActorMock, terminateUserSessionsForAdminMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  terminateUserSessionsForAdminMock: vi.fn(),
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
  terminateUserSessionsForAdmin: terminateUserSessionsForAdminMock,
}));

import { AuthorizationError } from '@/platform/errors';
import { POST } from '@/app/admin/api/users/[id]/sessions/route';

const SUPER_ADMIN = {
  userId: 'u1',
  roles: ['super_admin'],
  isSuperAdmin: true,
  permissions: [],
};

const ACCOUNT_ID = '0198f3a2-0000-7000-8000-000000000001';

function request(): Request {
  return new Request(`http://localhost:3000/admin/api/users/${ACCOUNT_ID}/sessions`, {
    method: 'POST',
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  resolveActorMock.mockReset();
  terminateUserSessionsForAdminMock.mockReset();
});

describe('POST /admin/api/users/[id]/sessions', () => {
  it('terminates the sessions of the account for a Super Admin', async () => {
    resolveActorMock.mockResolvedValue(SUPER_ADMIN);
    terminateUserSessionsForAdminMock.mockResolvedValue(undefined);

    const response = await POST(request(), context(ACCOUNT_ID));

    expect(response.status).toBe(200);
    expect(terminateUserSessionsForAdminMock).toHaveBeenCalledWith(SUPER_ADMIN, ACCOUNT_ID);
  });

  it('rejects a malformed account id before the workflow runs', async () => {
    resolveActorMock.mockResolvedValue(SUPER_ADMIN);

    const response = await POST(request(), context('not-a-uuid'));

    expect(response.status).toBe(400);
    expect(terminateUserSessionsForAdminMock).not.toHaveBeenCalled();
  });

  it('answers 403 when the actor may not terminate sessions', async () => {
    resolveActorMock.mockResolvedValue({ ...SUPER_ADMIN, isSuperAdmin: false });
    terminateUserSessionsForAdminMock.mockRejectedValue(
      new AuthorizationError('Only a Super Admin can terminate sessions.')
    );

    const response = await POST(request(), context(ACCOUNT_ID));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  it('rejects a cross-site request', async () => {
    resolveActorMock.mockResolvedValue(SUPER_ADMIN);

    const crossSite = new Request(
      `http://localhost:3000/admin/api/users/${ACCOUNT_ID}/sessions`,
      { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }
    );

    const response = await POST(crossSite, context(ACCOUNT_ID));

    expect(response.status).toBe(403);
    expect(terminateUserSessionsForAdminMock).not.toHaveBeenCalled();
  });
});
