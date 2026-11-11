import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, selectMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/platform/auth/better-auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock('@/db/client', () => ({
  db: { select: selectMock },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

import { getActiveSession } from '@/platform/auth/session';

/** Minimal Drizzle-like chain that resolves to the supplied rows. */
function query<T>(rows: T[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.from = chain;
  builder.where = chain;
  builder.limit = () => Promise.resolve(rows);
  return builder;
}

function sessionRow(overrides: Partial<{ lastActivityAt: Date | null }> = {}) {
  return {
    id: 'session-1',
    expiresAt: new Date(Date.now() + 60_000),
    lastActivityAt: new Date(),
    ipAddress: null,
    userAgent: null,
    ...overrides,
  };
}

function signedInAs(id = 'user-1') {
  getSessionMock.mockResolvedValue({
    user: { id, email: 'user@example.com', name: 'Test User' },
  });
}

describe('getActiveSession', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    selectMock.mockReset();
  });

  it('returns null without a session and does not query the database', async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(getActiveSession()).resolves.toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('returns null when the account row is missing', async () => {
    signedInAs();
    selectMock.mockReturnValue(query([]));

    await expect(getActiveSession()).resolves.toBeNull();
  });

  it('rejects an existing session for a deactivated user', async () => {
    signedInAs();
    selectMock.mockReturnValue(query([{ isActive: false, deletedAt: null }]));

    await expect(getActiveSession()).resolves.toBeNull();
  });

  it('rejects an existing session for a soft-deleted user', async () => {
    signedInAs();
    selectMock.mockReturnValue(query([{ isActive: true, deletedAt: new Date() }]));

    await expect(getActiveSession()).resolves.toBeNull();
  });

  it('returns the identity for an active user', async () => {
    signedInAs();
    selectMock
      .mockReturnValueOnce(query([{ isActive: true, deletedAt: null }]))
      .mockReturnValueOnce(query([{ isActive: true, deletedAt: null }]))
      .mockReturnValueOnce(query([sessionRow()]));

    await expect(getActiveSession()).resolves.toEqual({
      userId: 'user-1',
      userEmail: 'user@example.com',
      userName: 'Test User',
    });
  });

  it('treats a session without a recorded last activity as fresh', async () => {
    signedInAs();
    selectMock
      .mockReturnValueOnce(query([{ isActive: true, deletedAt: null }]))
      .mockReturnValueOnce(query([{ isActive: true, deletedAt: null }]))
      .mockReturnValueOnce(query([sessionRow({ lastActivityAt: null })]));

    await expect(getActiveSession()).resolves.toEqual({
      userId: 'user-1',
      userEmail: 'user@example.com',
      userName: 'Test User',
    });
  });
});
