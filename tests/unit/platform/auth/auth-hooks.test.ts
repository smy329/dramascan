import { beforeEach, describe, expect, it, vi } from 'vitest';

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/db/client', () => ({
  db: { select: selectMock, transaction: vi.fn() },
}));

vi.mock('@/platform/config', () => ({
  serverConfig: { superAdminEmail: null },
}));

import { assertUserCanCreateSession } from '@/platform/auth/auth-hooks';

type AccountStatus = { isActive: boolean; deletedAt: Date | null };

function query(rows: AccountStatus[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.from = chain;
  builder.where = chain;
  builder.limit = () => Promise.resolve(rows);
  return builder;
}

describe('assertUserCanCreateSession', () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  it('allows an active user', async () => {
    selectMock.mockReturnValue(query([{ isActive: true, deletedAt: null }]));

    await expect(assertUserCanCreateSession('user-1')).resolves.toBeUndefined();
  });

  it('rejects a deactivated user', async () => {
    selectMock.mockReturnValue(query([{ isActive: false, deletedAt: null }]));

    await expect(assertUserCanCreateSession('user-1')).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'ACCOUNT_NOT_ACTIVE' },
    });
  });

  it('rejects a soft-deleted user', async () => {
    selectMock.mockReturnValue(query([{ isActive: true, deletedAt: new Date() }]));

    await expect(assertUserCanCreateSession('user-1')).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'ACCOUNT_NOT_ACTIVE' },
    });
  });

  it('rejects a missing user', async () => {
    selectMock.mockReturnValue(query([]));

    await expect(assertUserCanCreateSession('user-1')).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'ACCOUNT_NOT_ACTIVE' },
    });
  });
});
