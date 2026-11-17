// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RoleManager } from '@/components/admin/roles/role-manager';
import type { AdminPermissionOption, AdminRoleView } from '@/lib/contracts/admin-authorization';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const ROLES: readonly AdminRoleView[] = [
  {
    id: 'role-1',
    name: 'content_editor',
    description: 'Edits catalogue content.',
    permissions: [{ permissionKey: 'drama.read', granted: true }],
    grantedPermissionKeys: ['drama.read'],
    userCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const PERMISSIONS: readonly AdminPermissionOption[] = [
  { key: 'drama.read', resource: 'drama', action: 'read', description: 'Read dramas.' },
  { key: 'drama.update', resource: 'drama', action: 'update', description: 'Update dramas.' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(call: unknown[] | undefined): unknown {
  const init = call?.[1] as { body?: string } | undefined;
  return init?.body ? JSON.parse(init.body) : undefined;
}

afterEach(cleanup);

beforeEach(() => {
  refreshMock.mockReset();
  vi.unstubAllGlobals();
});

describe('RoleManager', () => {
  it('creates a role through the REST API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          id: 'role-2',
          name: 'reviewer',
          description: 'Reviews submissions.',
          permissions: [],
          grantedPermissionKeys: [],
          userCount: 0,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<RoleManager initialRoles={ROLES} permissions={PERMISSIONS} />);

    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'reviewer' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Reviews submissions.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/api/roles');
    expect(init.method).toBe('POST');
    expect(requestBody(fetchMock.mock.calls[0])).toEqual({
      name: 'reviewer',
      description: 'Reviews submissions.',
    });

    await waitFor(() => expect(screen.getByText('reviewer')).toBeTruthy());
  });

  it('replaces the permission set of a role', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          id: 'role-1',
          name: 'content_editor',
          description: 'Edits catalogue content.',
          permissions: [
            { permissionKey: 'drama.read', granted: true },
            { permissionKey: 'drama.update', granted: true },
          ],
          grantedPermissionKeys: ['drama.read', 'drama.update'],
          userCount: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<RoleManager initialRoles={ROLES} permissions={PERMISSIONS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage permissions for content_editor' }));

    const dialog = await screen.findByRole('dialog');
    const updateBox = dialog.querySelector<HTMLInputElement>(
      'input[type="checkbox"][value="drama.update"]'
    );

    expect(updateBox).toBeTruthy();
    fireEvent.click(updateBox as HTMLInputElement);

    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/api/roles/role-1/permissions');
    expect(init.method).toBe('PUT');
    expect(requestBody(fetchMock.mock.calls[0])).toEqual({
      permissionKeys: ['drama.read', 'drama.update'],
    });
  });

  it('deletes a role after the confirmation is accepted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<RoleManager initialRoles={ROLES} permissions={PERMISSIONS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete role content_editor' }));

    const dialog = await screen.findByRole('alertdialog');
    const confirmButton = Array.from(dialog.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Delete'
    );

    expect(confirmButton).toBeTruthy();
    fireEvent.click(confirmButton as HTMLButtonElement);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/api/roles/role-1');
    expect(init.method).toBe('DELETE');
  });

  it('shows the failure message when a request is refused', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'conflict_error', message: 'A role with this name already exists.' } }, 409)
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<RoleManager initialRoles={ROLES} permissions={PERMISSIONS} />);

    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'content_editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }));

    expect(
      await screen.findByText('A role with this name already exists.')
    ).toBeTruthy();
  });
});
