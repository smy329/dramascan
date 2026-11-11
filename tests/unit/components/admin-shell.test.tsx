// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { pathnameState } = vi.hoisted(() => ({ pathnameState: { value: '/admin' } }));

vi.mock('next/navigation', () => ({ usePathname: () => pathnameState.value }));
vi.mock('@/workflows/auth/google-oauth', () => ({ googleSignOut: vi.fn() }));

import { AdminShell } from '@/components/admin/admin-shell';
import type { AdminNavGroup } from '@/components/admin/navigation';

const navigation: readonly AdminNavGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    entries: [
      {
        id: 'overview',
        label: 'Overview',
        href: '/admin',
        permissions: [],
        implemented: true,
      },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    entries: [
      {
        id: 'dramas',
        label: 'Dramas',
        href: '/admin/dramas',
        permissions: ['drama.read'],
        implemented: true,
      },
    ],
  },
];

const breadcrumbs = [{ label: 'Admin' }] as const;
const user = { name: 'Ada Lovelace', email: 'ada@example.com' } as const;

function renderShell() {
  return render(
    <AdminShell navigation={navigation} breadcrumbs={breadcrumbs} user={user}>
      <p>Admin content</p>
    </AdminShell>
  );
}

function isScrollLocked(): boolean {
  return (
    document.documentElement.hasAttribute('data-base-ui-scroll-locked') ||
    document.documentElement.style.overflowY === 'hidden' ||
    document.body.style.overflowY === 'hidden'
  );
}

beforeEach(() => {
  pathnameState.value = '/admin';
});

afterEach(cleanup);

describe('AdminShell', () => {
  it('renders permitted navigation and marks the active link', () => {
    renderShell();

    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dramas' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
  });

  it('renders breadcrumbs with a non-link current page', () => {
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('Admin');
    expect(current?.closest('a')).toBeNull();
  });

  it('renders the page content inside the main landmark', () => {
    renderShell();
    expect(screen.getByRole('main').textContent).toContain('Admin content');
  });

  it('opens the drawer from the mobile trigger', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Admin navigation' })).toBeTruthy();

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay?.className).toContain('bg-black/60');
  });

  it('closes the drawer on Escape and returns focus to the trigger', async () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('locks body scroll while open and restores it afterwards', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await screen.findByRole('dialog');

    await waitFor(() => expect(isScrollLocked()).toBe(true));

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(isScrollLocked()).toBe(false));
  });

  it('closes the drawer when the pathname changes', async () => {
    const view = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await screen.findByRole('dialog');

    pathnameState.value = '/admin/dramas';
    view.rerender(
      <AdminShell navigation={navigation} breadcrumbs={breadcrumbs} user={user}>
        <p>Admin content</p>
      </AdminShell>
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
