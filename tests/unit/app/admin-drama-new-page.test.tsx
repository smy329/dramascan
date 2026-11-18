// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock, listDramaTaxonomyMock, notFoundMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
  listDramaTaxonomyMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/app/admin/_access', () => ({ requireAdminPageAccess: requireAdminPageAccessMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('@/workflows/admin/dramas', () => ({ listDramaTaxonomy: listDramaTaxonomyMock }));
// The client form is exercised by its own test; the page only has to pass the
// taxonomy through, so the stub exposes what it received.
vi.mock('@/components/admin/dramas/drama-create-form', () => ({
  DramaCreateForm: ({
    categories,
    platforms,
  }: {
    categories: readonly { name: string }[];
    platforms: readonly { name: string }[];
  }) => (
    <div data-testid="drama-create-form">
      {categories.map(category => category.name).join('|')}/
      {platforms.map(platform => platform.name).join('|')}
    </div>
  ),
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

import AdminNewDramaPage from '@/app/admin/dramas/new/page';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

beforeEach(() => {
  requireAdminPageAccessMock.mockReset();
  listDramaTaxonomyMock.mockReset();
  notFoundMock.mockClear();
});

afterEach(cleanup);

describe('AdminNewDramaPage', () => {
  it('renders the form with the active taxonomy', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });
    listDramaTaxonomyMock.mockResolvedValue({
      categories: [{ id: 'c1', name: 'Romance' }],
      platforms: [{ id: 'p1', name: 'Netflix' }],
    });

    render(await AdminNewDramaPage());

    expect(screen.getByRole('heading', { name: 'Add drama' })).toBeTruthy();
    expect(screen.getByTestId('drama-create-form').textContent).toBe('Romance/Netflix');
    expect(listDramaTaxonomyMock).toHaveBeenCalledWith(manager);
  });

  it('renders the form when the taxonomy is empty', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: manager });
    listDramaTaxonomyMock.mockResolvedValue({ categories: [], platforms: [] });

    render(await AdminNewDramaPage());

    expect(screen.getByTestId('drama-create-form').textContent).toBe('/');
  });

  it('refuses an actor without drama.manage before reading the taxonomy', async () => {
    requireAdminPageAccessMock.mockResolvedValue({
      actor: { ...manager, permissions: [] },
    });

    await expect(AdminNewDramaPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalled();
    expect(listDramaTaxonomyMock).not.toHaveBeenCalled();
  });
});
