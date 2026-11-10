import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_PERMISSION_KEYS } from '@/modules/authorization/permissions';

const { getSessionMock, selectMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock('@/platform/auth/better-auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock('@/db/client', () => ({
  db: { select: selectMock },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

import { resolveActor } from '@/modules/authorization/actors';

type SelectResult = readonly Record<string, unknown>[];

/** Minimal Drizzle-like chain that resolves to the supplied rows. */
function query(result: SelectResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.from = chain;
  builder.innerJoin = chain;
  builder.leftJoin = chain;
  builder.where = chain;
  builder.limit = () => Promise.resolve(result);
  builder.then = (onFulfilled: (_rows: SelectResult) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return builder;
}

const activeUser = { isSuperAdmin: false, isActive: true, deletedAt: null };

beforeEach(() => {
  getSessionMock.mockReset();
  selectMock.mockReset();
});

describe('resolveActor', () => {
  it('returns an anonymous actor when there is no session', async () => {
    getSessionMock.mockResolvedValue(null);

    const actor = await resolveActor();

    expect(actor).toEqual({ userId: null, roles: [], isSuperAdmin: false, permissions: [] });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('returns an anonymous actor when the session user no longer exists', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    selectMock.mockReturnValueOnce(query([]));

    const actor = await resolveActor();

    expect(actor.userId).toBeNull();
    expect(actor.permissions).toEqual([]);
  });

  it('denies deactivated users that still hold a session', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    selectMock.mockReturnValueOnce(query([{ ...activeUser, isActive: false }]));

    const actor = await resolveActor();

    expect(actor.userId).toBeNull();
    expect(actor.permissions).toEqual([]);
  });

  it('denies soft-deleted users that still hold a session', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    selectMock.mockReturnValueOnce(query([{ ...activeUser, deletedAt: new Date() }]));

    const actor = await resolveActor();

    expect(actor.userId).toBeNull();
  });

  it('resolves a server-side Super Admin to the complete catalog', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'super-1' } });
    selectMock
      .mockReturnValueOnce(query([{ ...activeUser, isSuperAdmin: true }]))
      .mockReturnValueOnce(query([]));

    const actor = await resolveActor();

    expect(actor.userId).toBe('super-1');
    expect(actor.isSuperAdmin).toBe(true);
    expect(actor.permissions).toEqual(ALL_PERMISSION_KEYS);
  });

  it('unions granted permissions across the user roles', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    selectMock
      .mockReturnValueOnce(query([activeUser]))
      .mockReturnValueOnce(
        query([
          { roleName: 'moderator', permissionResource: 'review', permissionAction: 'manage', granted: true },
          { roleName: 'moderator', permissionResource: 'review', permissionAction: 'read', granted: true },
          { roleName: 'moderator', permissionResource: 'drama', permissionAction: 'delete', granted: false },
          { roleName: 'analyst', permissionResource: 'analytics', permissionAction: 'read', granted: true },
        ])
      );

    const actor = await resolveActor();

    expect(actor.isSuperAdmin).toBe(false);
    expect([...actor.roles].sort()).toEqual(['analyst', 'moderator']);
    expect([...actor.permissions].sort()).toEqual(['analytics.read', 'review.manage', 'review.read']);
  });

  it('ignores stored permissions that are not in the canonical catalog', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    selectMock
      .mockReturnValueOnce(query([activeUser]))
      .mockReturnValueOnce(
        query([
          { roleName: 'legacy', permissionResource: 'role', permissionAction: 'update', granted: true },
          { roleName: 'legacy', permissionResource: 'drama', permissionAction: 'read', granted: true },
        ])
      );

    const actor = await resolveActor();

    expect(actor.permissions).toEqual(['drama.read']);
  });
});
