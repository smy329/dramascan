// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock, loadSimilarDramasPageMock, notFoundMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
  loadSimilarDramasPageMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/app/admin/_access', () => ({ requireAdminPageAccess: requireAdminPageAccessMock }));
vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/workflows/admin/similar-dramas', () => ({
  parseSimilarDramaTableQuery: () => ({
    page: 1,
    pageSize: 20,
    sort: 'position',
    order: 'asc',
    search: undefined,
  }),
  formatSimilarDramaSortToken: () => 'position',
  loadSimilarDramasPage: loadSimilarDramasPageMock,
}));
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

import AdminSimilarDramasPage from '@/app/admin/dramas/[id]/similar-dramas/page';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['similar_drama.manage'],
};

const DRAMA_ID = '3fbc8b1a-3b0e-4f43-a7fd-c22f2d6c4e4f';

afterEach(cleanup);

beforeEach(() => {
  requireAdminPageAccessMock.mockReset();
  loadSimilarDramasPageMock.mockReset();
  notFoundMock.mockClear();
});

describe('AdminSimilarDramasPage', () => {
  it('awaits the route parameters and renders the manager for the requested drama', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });
    loadSimilarDramasPageMock.mockResolvedValue({
      drama: { id: DRAMA_ID, title: 'Seasons of Glass' },
      result: {
        items: [
          {
            id: 'a1',
            title: 'Stone Wall',
            poster: null,
            description: null,
            position: 0,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    render(
      await AdminSimilarDramasPage({
        params: Promise.resolve({ id: DRAMA_ID }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(loadSimilarDramasPageMock).toHaveBeenCalledWith(manager, DRAMA_ID, expect.any(Object));
    expect(screen.getByRole('heading', { name: /Seasons of Glass/ })).toBeTruthy();
    expect(screen.getByText('Stone Wall')).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('returns not-found for an unknown drama id', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });

    const { NotFoundError } = await import('@/platform/errors');
    loadSimilarDramasPageMock.mockRejectedValue(new NotFoundError('Drama not found.'));

    await expect(
      AdminSimilarDramasPage({
        params: Promise.resolve({ id: 'not-a-uuid' }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('returns not-found without loading data for an actor without the drill-down permission', async () => {
    requireAdminPageAccessMock.mockResolvedValue({
      actor: { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['drama.manage'] },
    });

    await expect(
      AdminSimilarDramasPage({
        params: Promise.resolve({ id: DRAMA_ID }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(loadSimilarDramasPageMock).not.toHaveBeenCalled();
  });
});
