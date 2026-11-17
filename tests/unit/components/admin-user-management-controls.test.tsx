// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { UserManagementControls } from '@/components/admin/users/user-management-controls';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const USER = {
  id: 'user-1',
  name: 'Ada Lovelace',
  status: 'active' as const,
  isSuperAdmin: false,
  roles: [{ roleId: 'role-1', roleName: 'content_editor', assignedAt: '2026-01-01T00:00:00.000Z' }],
};

const AVAILABLE_ROLES = [
  { id: 'role-1', name: 'content_editor' },
  { id: 'role-2', name: 'reviewer' },
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

describe('UserManagementControls', () => {
  it('deactivates the account through the status API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { id: 'user-1', isActive: false } })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <UserManagementControls
        user={USER}
        availableRoles={AVAILABLE_ROLES}
        canManageStatus
        canManageRoles
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Ada Lovelace' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/api/users/user-1/status');
    expect(init.method).toBe('POST');
    expect(requestBody(fetchMock.mock.calls[0])).toEqual({ isActive: false });
  });

  it('reactivates a deactivated account', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { id: 'user-1', isActive: true } })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <UserManagementControls
        user={{ ...USER, status: 'deactivated' }}
        availableRoles={AVAILABLE_ROLES}
        canManageStatus
        canManageRoles
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate Ada Lovelace' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(requestBody(fetchMock.mock.calls[0])).toEqual({ isActive: true });
  });

  it('assigns a role through the role API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <UserManagementControls
        user={USER}
        availableRoles={AVAILABLE_ROLES}
        canManageStatus
        canManageRoles
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage roles for Ada Lovelace' }));

    const dialog = await screen.findByRole('dialog');
    const reviewerBox = dialog.querySelector<HTMLInputElement>(
      'input[type="checkbox"][value="role-2"]'
    );

    expect(reviewerBox).toBeTruthy();
    fireEvent.click(reviewerBox as HTMLInputElement);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/api/users/user-1/roles');
    expect(init.method).toBe('POST');
    expect(requestBody(fetchMock.mock.calls[0])).toEqual({ roleId: 'role-2' });
  });

  it('revokes a role through the role API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <UserManagementControls
        user={USER}
        availableRoles={AVAILABLE_ROLES}
        canManageStatus
        canManageRoles
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage roles for Ada Lovelace' }));

    const dialog = await screen.findByRole('dialog');
    const editorBox = dialog.querySelector<HTMLInputElement>(
      'input[type="checkbox"][value="role-1"]'
    );

    expect(editorBox?.checked).toBe(true);
    fireEvent.click(editorBox as HTMLInputElement);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/api/users/user-1/roles/role-1');
    expect(init.method).toBe('DELETE');
  });

  it('flips the checkbox immediately and keeps the change when the request succeeds', async () => {
    let resolveRequest: (_value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          resolveRequest = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <UserManagementControls
        user={USER}
        availableRoles={AVAILABLE_ROLES}
        canManageStatus
        canManageRoles
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage roles for Ada Lovelace' }));

    const dialog = await screen.findByRole('dialog');
    const reviewerBox = dialog.querySelector<HTMLInputElement>(
      'input[type="checkbox"][value="role-2"]'
    );

    fireEvent.click(reviewerBox as HTMLInputElement);

    // The control must answer the click at once. A checkbox that only moves
    // after the server replies reads as broken to the person using it.
    await waitFor(() => expect(reviewerBox?.checked).toBe(true));

    resolveRequest(jsonResponse({ data: [] }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reviewerBox?.checked).toBe(true));
  });

  it('restores the previous assignment when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'conflict_error', message: 'The role could not be assigned.' } }, 409)
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <UserManagementControls
        user={USER}
        availableRoles={AVAILABLE_ROLES}
        canManageStatus
        canManageRoles
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage roles for Ada Lovelace' }));

    const dialog = await screen.findByRole('dialog');
    const reviewerBox = dialog.querySelector<HTMLInputElement>(
      'input[type="checkbox"][value="role-2"]'
    );

    fireEvent.click(reviewerBox as HTMLInputElement);

    expect(await screen.findByText('The role could not be assigned.')).toBeTruthy();

    // The checkbox must fall back to the stored state: the assignment never
    // happened, so the UI must not claim that it did.
    const editorBox = dialog.querySelector<HTMLInputElement>(
      'input[type="checkbox"][value="role-1"]'
    );
    const failedBox = dialog.querySelector<HTMLInputElement>(
      'input[type="checkbox"][value="role-2"]'
    );

    expect(editorBox?.checked).toBe(true);
    expect(failedBox?.checked).toBe(false);
  });

  it('hides the role control from an actor that cannot assign roles', () => {
    render(
      <UserManagementControls
        user={USER}
        availableRoles={AVAILABLE_ROLES}
        canManageStatus
        canManageRoles={false}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Manage roles for Ada Lovelace' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Deactivate Ada Lovelace' })).toBeTruthy();
  });

  it('hides the status control from an actor that cannot change account status', () => {
    render(
      <UserManagementControls
        user={USER}
        availableRoles={AVAILABLE_ROLES}
        canManageStatus={false}
        canManageRoles
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Deactivate Ada Lovelace' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Manage roles for Ada Lovelace' })
    ).toBeTruthy();
  });
});
