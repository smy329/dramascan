// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
}));

vi.mock('@/app/admin/_access', () => ({
  requireAdminPageAccess: requireAdminPageAccessMock,
}));

import AdminOverviewPage from '@/app/admin/page';

afterEach(cleanup);

it('checks admin access itself before rendering and shows the real roles', async () => {
  requireAdminPageAccessMock.mockResolvedValue({
    actor: {
      userId: 'user-1',
      roles: ['content_manager'],
      isSuperAdmin: false,
      permissions: ['drama.read'],
    },
    user: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });

  render(await AdminOverviewPage());

  expect(requireAdminPageAccessMock).toHaveBeenCalledWith('/admin');
  expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
  expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
  expect(screen.getByText('content_manager')).toBeTruthy();
});
