// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock, listUsersForAdminMock, notFoundMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
  listUsersForAdminMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

function formatSortTokenStub(sortBy: string, sortDirection: string): string {
  return sortDirection === 'desc' ? `-${sortBy}` : sortBy;
}

vi.mock('server-only', () => ({}));

vi.mock('@/app/admin/_access', () => ({ requireAdminPageAccess: requireAdminPageAccessMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
// The real guards decide, so the test proves the page checks the canonical key.
vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...permissions, ...guards };
});
vi.mock('@/modules/users', () => ({
  listUsersForAdmin: listUsersForAdminMock,
  parseAdminUsersQuery: (input: unknown) => ({
    page: 1,
    pageSize: 20,
    sortBy: 'createdAt',
    sortDirection: 'desc',
    search: '',
    status: null,
    superAdmin: null,
    ...(input as Record<string, unknown>),
  }),
  formatSortToken: formatSortTokenStub,
}));

import AdminUsersPage from '@/app/admin/users/page';

afterEach(cleanup);

const superAdmin = { userId: 'u1', roles: [], isSuperAdmin: true, permissions: [] };
const analyst = { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['analytics.read'] };

beforeEach(() => {
  requireAdminPageAccessMock.mockReset();
  listUsersForAdminMock.mockReset();
});

describe('AdminUsersPage', () => {
  it('renders the listing for an actor with user.read', async () => {
    requireAdminPageAccessMock.mockResolvedValue({
      actor: superAdmin,
      user: { name: 'Root', email: 'root@example.com' },
    });
    listUsersForAdminMock.mockResolvedValue({
      items: [
        {
          id: 'a',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          status: 'active',
          isSuperAdmin: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });

    render(await AdminUsersPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Ada Lovelace' })).toBeTruthy();
    expect(listUsersForAdminMock).toHaveBeenCalled();
  });

  it('returns the not-found behaviour for an admin-area actor without user.read', async () => {
    requireAdminPageAccessMock.mockResolvedValue({
      actor: analyst,
      user: { name: 'Analyst', email: 'a@example.com' },
    });

    await expect(AdminUsersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(listUsersForAdminMock).not.toHaveBeenCalled();
  });
});
