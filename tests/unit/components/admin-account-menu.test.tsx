// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/workflows/auth/google-oauth', () => ({ googleSignOut: vi.fn() }));

import { AdminAccountMenu, getInitials } from '@/components/admin/admin-account-menu';

afterEach(cleanup);

const user = { name: 'Ada Lovelace', email: 'ada@example.com' } as const;

it('derives initials from the name, then the email', () => {
  expect(getInitials('Ada Lovelace', 'ada@example.com')).toBe('AL');
  expect(getInitials('Ada', 'ada@example.com')).toBe('A');
  expect(getInitials('', 'ada@example.com')).toBe('A');
  expect(getInitials('', '')).toBe('?');
});

it('shows the identity and navigation actions in the menu', async () => {
  render(<AdminAccountMenu user={user} />);

  fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));

  const menu = await screen.findByRole('menu');
  expect(within(menu).getByText('Ada Lovelace')).toBeTruthy();
  expect(within(menu).getByText('ada@example.com')).toBeTruthy();

  const account = screen.getByRole('menuitem', { name: 'Your account' });
  const site = screen.getByRole('menuitem', { name: 'View site' });
  expect(account.getAttribute('href')).toBe('/dashboard');
  expect(site.getAttribute('href')).toBe('/');
});

it('submits sign-out through the existing server action', async () => {
  render(<AdminAccountMenu user={user} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));

  const signOut = await screen.findByRole('menuitem', { name: 'Sign out' });
  expect(signOut.getAttribute('type')).toBe('submit');
  expect(signOut.closest('form')).not.toBeNull();
});
