import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listUserAccountsMock } = vi.hoisted(() => ({ listUserAccountsMock: vi.fn() }));

vi.mock('@/modules/auth', () => ({ listUserAccounts: listUserAccountsMock }));
vi.mock('server-only', () => ({}));
vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...guards, ...permissions };
});

import type { ActorContext } from '@/modules/authorization';
import { AuthenticationError, AuthorizationError } from '@/platform/errors';

import { listUsersForAdmin } from '@/modules/users/read-models/admin-users';
import type { AdminUsersQuery } from '@/modules/users/validation';

const anonymous: ActorContext = { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
const reader: ActorContext = { userId: 'u1', roles: [], isSuperAdmin: false, permissions: ['user.read'] };
const other: ActorContext = { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['user.manage'] };

const query: AdminUsersQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'createdAt',
  sortDirection: 'desc',
  search: '',
  status: null,
  superAdmin: null,
};

beforeEach(() => {
  listUserAccountsMock.mockReset();
});

describe('listUsersForAdmin', () => {
  it('rejects an anonymous actor before querying', async () => {
    await expect(listUsersForAdmin(anonymous, query)).rejects.toBeInstanceOf(AuthenticationError);
    expect(listUserAccountsMock).not.toHaveBeenCalled();
  });

  it('rejects an actor without user.read before querying', async () => {
    await expect(listUsersForAdmin(other, query)).rejects.toBeInstanceOf(AuthorizationError);
    expect(listUserAccountsMock).not.toHaveBeenCalled();
  });

  it('returns projected rows and the page metadata', async () => {
    listUserAccountsMock.mockResolvedValue({
      total: 42,
      rows: [
        {
          id: 'a',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          isActive: true,
          isSuperAdmin: false,
          createdAt: new Date('2026-01-02T03:04:05.000Z'),
          updatedAt: new Date('2026-01-02T03:04:05.000Z'),
          deletedAt: null,
        },
      ],
    });

    const result = await listUsersForAdmin(reader, query);

    expect(result.items).toEqual([
      {
        id: 'a',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        status: 'active',
        isSuperAdmin: false,
        createdAt: '2026-01-02T03:04:05.000Z',
        updatedAt: '2026-01-02T03:04:05.000Z',
      },
    ]);
    expect(result.total).toBe(42);
    expect(result.totalPages).toBe(3);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('reports no pages for an empty result', async () => {
    listUserAccountsMock.mockResolvedValue({ total: 0, rows: [] });

    const result = await listUsersForAdmin(reader, query);

    expect(result.totalPages).toBe(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('clamps a page past the last page to the last page', async () => {
    listUserAccountsMock
      .mockResolvedValueOnce({ total: 42, rows: [] })
      .mockResolvedValueOnce({
        total: 42,
        rows: [
          {
            id: 'c',
            name: 'Grace Hopper',
            email: 'grace@example.com',
            isActive: true,
            isSuperAdmin: false,
            createdAt: new Date('2026-01-02T03:04:05.000Z'),
            updatedAt: new Date('2026-01-02T03:04:05.000Z'),
            deletedAt: null,
          },
        ],
      });

    const result = await listUsersForAdmin(reader, { ...query, page: 8 });

    // 42 accounts at 20 per page is three pages, so page 8 does not exist.
    expect(result.page).toBe(3);
    expect(result.totalPages).toBe(3);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(true);

    // The clamped page is read, not merely reported: the table shows the rows
    // the summary now describes instead of an empty table.
    expect(listUserAccountsMock).toHaveBeenCalledTimes(2);
    expect(listUserAccountsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    expect(result.items.map(item => item.id)).toEqual(['c']);
  });

  it('clamps an empty result to page 1', async () => {
    listUserAccountsMock.mockResolvedValue({ total: 0, rows: [] });

    const result = await listUsersForAdmin(reader, { ...query, page: 4 });

    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('derives the status with deleted taking precedence over the active flag', async () => {
    listUserAccountsMock.mockResolvedValue({
      total: 1,
      rows: [
        {
          id: 'b',
          name: 'Deleted Person',
          email: 'deleted@example.com',
          isActive: true,
          isSuperAdmin: false,
          createdAt: new Date('2026-01-02T03:04:05.000Z'),
          updatedAt: new Date('2026-01-02T03:04:05.000Z'),
          deletedAt: new Date('2026-01-02T03:04:05.000Z'),
        },
      ],
    });

    const result = await listUsersForAdmin(reader, query);

    expect(result.items[0]?.status).toBe('deleted');
  });

  it('passes the validated query to the identity query', async () => {
    listUserAccountsMock.mockResolvedValue({ total: 0, rows: [] });

    await listUsersForAdmin(reader, { ...query, search: 'lee', status: 'active', superAdmin: true });

    expect(listUserAccountsMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: 'lee',
      status: 'active',
      isSuperAdmin: true,
    });

    // An in-range page is read exactly once: the clamp costs nothing on every
    // ordinary navigation.
    expect(listUserAccountsMock).toHaveBeenCalledTimes(1);
  });
});
