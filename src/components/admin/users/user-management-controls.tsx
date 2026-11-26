'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  AdminAssignableRoleView,
  AdminUserRoleView,
} from '@/lib/contracts/admin-authorization';

/**
 * Per-account administration controls.
 *
 * The server page owns authorization and decides which controls an actor may
 * use; the API re-checks every call. Account status, role assignment, and
 * session termination are separate decisions:
 *
 * - Changing an account's status keeps the canonical `admin.manage`
 *   requirement. A Super Admin account can only be changed by a Super Admin,
 *   and the API refuses it otherwise.
 * - Assigning or revoking a role grants or removes access, so it is Super
 *   Admin only.
 * - Terminating the sessions signs an administrator out of every device, so it
 *   is Super Admin only, and it is confirmed before it runs.
 *
 * The role editor reflects the stored assignments. Toggling a role on assigns
 * it, toggling it off revokes it; each toggle is one request, so a failure
 * leaves the stored state exactly as it was.
 */

export type AdminUserStatus = 'active' | 'deactivated' | 'deleted';

export type UserManagementControlsProps = Readonly<{
  user: {
    id: string;
    name: string;
    status: AdminUserStatus;
    isSuperAdmin: boolean;
    roles: readonly AdminUserRoleView[];
  };
  availableRoles: readonly AdminAssignableRoleView[];
  canManageStatus: boolean;
  canManageRoles: boolean;
  /** Super Admin only: ending the sessions of an account signs it out everywhere. */
  canManageSessions: boolean;
}>;

function readErrorMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const candidate = body as { error?: { message?: unknown }; message?: unknown };

    if (typeof candidate.error?.message === 'string') return candidate.error.message;
    if (typeof candidate.message === 'string') return candidate.message;
  }

  return 'The request failed.';
}

async function readFailure(response: Response): Promise<string> {
  try {
    return readErrorMessage(await response.json());
  } catch {
    return 'The request failed.';
  }
}

export function UserManagementControls({
  user,
  availableRoles,
  canManageStatus,
  canManageRoles,
  canManageSessions,
}: UserManagementControlsProps): JSX.Element {
  const router = useRouter();

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [assignedRoleIds, setAssignedRoleIds] = useState<readonly string[]>(
    user.roles.map(role => role.roleId)
  );

  function clearFailure(): void {
    setError(null);
  }

  async function send(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(await readFailure(response));
    }

    return response;
  }

  async function changeStatus(isActive: boolean): Promise<void> {
    setPending('status');
    clearFailure();

    try {
      await send(`/admin/api/users/${user.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ isActive }),
      });

      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The account status could not be changed.');
    } finally {
      setPending(null);
    }
  }

  async function toggleRole(role: AdminAssignableRoleView, assigned: boolean): Promise<void> {
    setPending(`role:${role.id}`);
    clearFailure();

    // The checkbox answers the click at once. A control that only moves after
    // the server replies reads as broken, so the change is applied locally
    // first and rolled back if the request is refused.
    const previous = assignedRoleIds;

    setAssignedRoleIds(current => {
      const next = assigned ? [...current, role.id] : current.filter(id => id !== role.id);
      return next;
    });

    try {
      if (assigned) {
        await send(`/admin/api/users/${user.id}/roles`, {
          method: 'POST',
          body: JSON.stringify({ roleId: role.id }),
        });
      } else {
        await send(`/admin/api/users/${user.id}/roles/${role.id}`, { method: 'DELETE' });
      }

      router.refresh();
    } catch (cause) {
      setAssignedRoleIds(previous);
      setError(cause instanceof Error ? cause.message : 'The role assignment could not be changed.');
    } finally {
      setPending(null);
    }
  }

  async function terminateSessions(): Promise<void> {
    setPending('sessions');
    clearFailure();

    try {
      await send(`/admin/api/users/${user.id}/sessions`, { method: 'POST' });

      setSessionsOpen(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The sessions could not be terminated.'
      );
    } finally {
      setPending(null);
    }
  }

  const isDeleted = user.status === 'deleted';
  const isActive = user.status === 'active';
  const statusLabel = isActive ? 'Deactivate' : 'Reactivate';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canManageStatus && !isDeleted ? (
          <Button
            type="button"
            size="sm"
            variant={isActive ? 'outline' : 'default'}
            onClick={() => void changeStatus(!isActive)}
            disabled={pending !== null}
            aria-busy={pending === 'status' ? true : undefined}
            aria-label={`${statusLabel} ${user.name}`}
          >
            {statusLabel}
          </Button>
        ) : null}

        {canManageRoles ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setRolesOpen(true);
              clearFailure();
            }}
            disabled={pending !== null}
            aria-label={`Manage roles for ${user.name}`}
          >
            Roles
          </Button>
        ) : null}

        {canManageSessions && !isDeleted ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setSessionsOpen(true);
              clearFailure();
            }}
            disabled={pending !== null}
            aria-label={`Terminate sessions for ${user.name}`}
          >
            Terminate sessions
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog
        open={rolesOpen}
        onOpenChange={open => {
          if (!open) setRolesOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Roles of {user.name}</DialogTitle>
            <DialogDescription>
              Assigning a role grants its permissions. Only a Super Admin can change the roles of
              an account.
            </DialogDescription>
          </DialogHeader>

          {availableRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles exist yet.</p>
          ) : (
            <ul className="space-y-2">
              {availableRoles.map(role => {
                const assigned = assignedRoleIds.includes(role.id);

                return (
                  <li key={role.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50">
                      <input
                        type="checkbox"
                        value={role.id}
                        aria-label={role.name}
                        checked={assigned}
                        disabled={pending !== null}
                        onChange={event => void toggleRole(role, event.target.checked)}
                        className="size-4 accent-primary"
                      />
                      <span className="font-mono text-xs text-foreground">{role.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRolesOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={sessionsOpen}
        onOpenChange={open => {
          if (!open && pending !== 'sessions') {
            setSessionsOpen(false);
          }
        }}
        onConfirm={() => void terminateSessions()}
        isPending={pending === 'sessions'}
        error={error}
        title={`Terminate the sessions of ${user.name}`}
        description="The account is signed out of every device. The owner has to sign in again."
        confirmLabel="Terminate sessions"
        pendingLabel="Terminating…"
        variant="destructive"
      />
    </div>
  );
}
