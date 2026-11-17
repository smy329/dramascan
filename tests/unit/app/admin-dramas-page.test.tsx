// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock, listConversionCandidatesMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
  listConversionCandidatesMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/app/admin/_access', () => ({ requireAdminPageAccess: requireAdminPageAccessMock }));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/workflows/admin/conversion', () => ({
  formatConversionSortToken: () => 'title.asc',
  parseConversionListQuery: () => ({
    page: 1,
    pageSize: 20,
    sortBy: 'title',
    sortDirection: 'asc',
    search: '',
  }),
  listConversionCandidates: listConversionCandidatesMock,
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

import AdminDramasPage from '@/app/admin/dramas/page';

const DRAMA_ID = '3fbc8b1a-3b0e-4f43-a7fd-c22f2d6c4e4f';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'similar_drama.manage'],
};

afterEach(cleanup);

beforeEach(() => {
  requireAdminPageAccessMock.mockReset();
  listConversionCandidatesMock.mockReset();
});

describe('AdminDramasPage', () => {
  it('links each drama to its similar-drama management page', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });
    listConversionCandidatesMock.mockResolvedValue({
      items: [
        {
          id: DRAMA_ID,
          title: 'Seasons of Glass',
          structureType: 'season_based',
          activeEpisodes: 2,
          createdAt: '2026-11-01T12:00:00.000Z',
        },
      ],
      total: 1,
      totalPages: 1,
      page: 1,
      pageSize: 20,
    });

    render(await AdminDramasPage({ searchParams: Promise.resolve({}) }));

    const link = screen.getByRole('link', { name: 'Manage similar dramas' });

    expect(link.getAttribute('href')).toBe(`/admin/dramas/${DRAMA_ID}/similar-dramas`);
  });

  it('hides the similar-drama action from an actor without the drill-down permission', async () => {
    requireAdminPageAccessMock.mockResolvedValue({
      actor: { ...manager, permissions: ['drama.manage'] },
    });
    listConversionCandidatesMock.mockResolvedValue({
      items: [
        {
          id: DRAMA_ID,
          title: 'Seasons of Glass',
          structureType: 'season_based',
          activeEpisodes: 2,
          createdAt: '2026-11-01T12:00:00.000Z',
        },
      ],
      total: 1,
      totalPages: 1,
      page: 1,
      pageSize: 20,
    });

    render(await AdminDramasPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole('link', { name: 'Manage similar dramas' })).toBeNull();
  });
});
