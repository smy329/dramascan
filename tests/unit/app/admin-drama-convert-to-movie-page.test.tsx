// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock, loadContextMock, notFoundMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
  loadContextMock: vi.fn(),
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
vi.mock('@/workflows/admin/movie-conversion', () => ({
  loadMovieConversionContext: loadContextMock,
}));
vi.mock('@/workflows/admin/movie-conversion-actions', () => ({
  previewDramaMovieConversion: vi.fn(),
  applyDramaMovieConversion: vi.fn(),
}));
// The real guards and permission keys decide, so the test proves the page
// checks the canonical permission itself.
vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...permissions, ...guards };
});

import AdminDramaConvertToMoviePage from '@/app/admin/dramas/[id]/convert-to-movie/page';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

function context(overrides: Record<string, unknown> = {}) {
  return {
    drama: {
      id: '0198f3a2-0000-7000-8000-000000000010',
      title: 'Seasons of Glass',
      slug: 'seasons-of-glass',
      description: null,
      poster: null,
      banner: null,
      publicationStatus: 'published',
      createdAt: '2026-01-01T00:00:00.000Z',
      structureType: 'flat',
    },
    activeEpisodes: [
      {
        id: '0198f3a2-0000-7000-8000-000000000011',
        title: 'The Last Winter',
        episodeNumber: 1,
        position: 0,
        seasonId: null,
        videoSource: 'https://media.example.com/episodes/glass.mp4',
      },
    ],
    eligible: true,
    ineligibilityReason: null,
    slugConflict: null,
    existingMovie: null,
    ...overrides,
  };
}

afterEach(cleanup);

beforeEach(() => {
  requireAdminPageAccessMock.mockReset();
  loadContextMock.mockReset();
  notFoundMock.mockClear();
});

describe('AdminDramaConvertToMoviePage', () => {
  it('renders the conversion panel for an eligible drama', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });
    loadContextMock.mockResolvedValue(context());

    render(await AdminDramaConvertToMoviePage({ params: Promise.resolve({ id: 'drama-1' }) }));

    expect(screen.getByRole('heading', { name: /Convert .*Seasons of Glass.* to a movie/ })).toBeTruthy();
    expect(loadContextMock).toHaveBeenCalledWith(manager, 'drama-1');
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('renders the ineligibility reason instead of the actions', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });
    loadContextMock.mockResolvedValue(
      context({
        eligible: false,
        ineligibilityReason: 'The drama has 2 active episodes.',
        activeEpisodes: [
          { id: 'e1', title: 'E1', episodeNumber: 1, position: 0, seasonId: null, videoSource: null },
          { id: 'e2', title: 'E2', episodeNumber: 2, position: 1, seasonId: null, videoSource: null },
        ],
      })
    );

    render(await AdminDramaConvertToMoviePage({ params: Promise.resolve({ id: 'drama-1' }) }));

    expect(screen.getByRole('alert').textContent).toContain('2 active episodes');
    expect(screen.queryByRole('button', { name: 'Preview conversion' })).toBeNull();
  });

  it('returns a 404 for a malformed or missing drama', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });

    const { NotFoundError } = await import('@/platform/errors');
    loadContextMock.mockRejectedValue(new NotFoundError('Drama not found.'));

    await expect(
      AdminDramaConvertToMoviePage({ params: Promise.resolve({ id: 'not-a-uuid' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('returns a 404 for an actor without drama.manage', async () => {
    requireAdminPageAccessMock.mockResolvedValue({
      actor: { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['drama.read'] },
    });

    await expect(
      AdminDramaConvertToMoviePage({ params: Promise.resolve({ id: 'drama-1' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(loadContextMock).not.toHaveBeenCalled();
  });
});
