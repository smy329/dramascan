// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock, loadConversionContextMock, notFoundMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
  loadConversionContextMock: vi.fn(),
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
vi.mock('@/workflows/admin/conversion', () => ({
  loadConversionContext: loadConversionContextMock,
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

import AdminDramaConvertPage from '@/app/admin/dramas/[id]/convert/page';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

afterEach(cleanup);

beforeEach(() => {
  requireAdminPageAccessMock.mockReset();
  loadConversionContextMock.mockReset();
  notFoundMock.mockClear();
});

describe('AdminDramaConvertPage', () => {
  it('renders the conversion panel for a known drama', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });
    loadConversionContextMock.mockResolvedValue({
      drama: { id: 'drama-1', title: 'Seasons of Glass', structureType: 'season_based' },
      seasons: [],
      episodes: [],
      availableSnapshot: null,
    });

    render(
      await AdminDramaConvertPage({ params: Promise.resolve({ id: 'drama-1' }) })
    );

    expect(screen.getByText('Convert “Seasons of Glass”')).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('returns a 404 for a malformed drama id', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });

    const { NotFoundError } = await import('@/platform/errors');
    loadConversionContextMock.mockRejectedValue(new NotFoundError('Drama not found.'));

    await expect(
      AdminDramaConvertPage({ params: Promise.resolve({ id: 'not-a-uuid' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('returns a 404 for an actor without drama.manage', async () => {
    requireAdminPageAccessMock.mockResolvedValue({
      actor: { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['drama.read'] },
    });

    await expect(
      AdminDramaConvertPage({ params: Promise.resolve({ id: 'drama-1' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(loadConversionContextMock).not.toHaveBeenCalled();
  });
});
