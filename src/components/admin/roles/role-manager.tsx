'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { EmptyState } from '@/components/states/empty-state';
import { RetryState } from '@/components/states/retry-state';
import { RetryButton } from '@/components/states/retry-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminPermissionOption, AdminRoleView } from '@/lib/contracts/admin-authorization';

/**
 * Super Admin role and permission console.
 *
 * The server page owns authorization and the first read; this island owns only
 * the interactions. Every mutation goes through the method-correct admin API
 * (`POST` to create, `PATCH` to update, `PUT` to replace a permission set,
 * `DELETE` to remove) and the server re-checks the actor on every call.
 *
 * Nothing is trusted from the browser: the permission set is replaced with the
 * whole catalog selection, so a key the browser invented is rejected by the
 * server instead of being stored.
 */

export type RoleManagerProps = Readonly<{
  initialRoles: readonly AdminRoleView[];
  permissions: readonly AdminPermissionOption[];
}>;

type RoleDraft = {
  name: string;
  description: string;
};

const EMPTY_DRAFT: RoleDraft = { name: '', description: '' };

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

function groupPermissions(
  permissions: readonly AdminPermissionOption[]
): readonly { resource: string; options: readonly AdminPermissionOption[] }[] {
  const groups = new Map<string, AdminPermissionOption[]>();

  for (const option of permissions) {
    const list = groups.get(option.resource) ?? [];
    list.push(option);
    groups.set(option.resource, list);
  }

  return Array.from(groups.entries()).map(([resource, options]) => ({ resource, options }));
}

/** Swap one role for the updated copy, keeping the order of the list. */
function replaceRole(
  current: readonly AdminRoleView[],
  updated: AdminRoleView
): readonly AdminRoleView[] {
  const next: AdminRoleView[] = [];

  for (const role of current) {
    next.push(role.id === updated.id ? updated : role);
  }

  return next;
}

export function RoleManager({ initialRoles, permissions }: RoleManagerProps): JSX.Element {
  const router = useRouter();

  const [roles, setRoles] = useState<readonly AdminRoleView[]>(initialRoles);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<RoleDraft>(EMPTY_DRAFT);

  const [editing, setEditing] = useState<AdminRoleView | null>(null);
  const [editDraft, setEditDraft] = useState<RoleDraft>(EMPTY_DRAFT);

  const [permissionRole, setPermissionRole] = useState<AdminRoleView | null>(null);
  const [permissionSelection, setPermissionSelection] = useState<readonly string[]>([]);

  const [deleting, setDeleting] = useState<AdminRoleView | null>(null);

  const permissionGroups = groupPermissions(permissions);

  function clearFailure(): void {
    setError(null);
  }

  function fail(message: string): void {
    setError(message);
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

  async function createRole(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending('create');
    clearFailure();

    try {
      const response = await send('/admin/api/roles', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim() === '' ? null : draft.description.trim(),
        }),
      });

      const body = (await response.json()) as { data: AdminRoleView };
      setRoles(current => [...current, body.data]);
      setDraft(EMPTY_DRAFT);
      router.refresh();
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'The role could not be created.');
    } finally {
      setPending(null);
    }
  }

  function openEdit(role: AdminRoleView): void {
    setEditing(role);
    setEditDraft({ name: role.name, description: role.description ?? '' });
    clearFailure();
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!editing) return;

    setPending(`edit:${editing.id}`);
    clearFailure();

    try {
      const response = await send(`/admin/api/roles/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editDraft.name.trim(),
          description: editDraft.description.trim() === '' ? null : editDraft.description.trim(),
        }),
      });

      const body = (await response.json()) as { data: AdminRoleView };
      setRoles(current => replaceRole(current, body.data));
      setEditing(null);
      router.refresh();
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'The role could not be updated.');
    } finally {
      setPending(null);
    }
  }

  function openPermissions(role: AdminRoleView): void {
    setPermissionRole(role);
    setPermissionSelection(role.grantedPermissionKeys);
    clearFailure();
  }

  function togglePermission(key: string, checked: boolean): void {
    setPermissionSelection(current => {
      const next = checked ? [...current, key] : current.filter(item => item !== key);
      return next;
    });
  }

  async function savePermissions(): Promise<void> {
    if (!permissionRole) return;

    setPending(`permissions:${permissionRole.id}`);
    clearFailure();

    try {
      const response = await send(`/admin/api/roles/${permissionRole.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissionKeys: permissionSelection }),
      });

      const body = (await response.json()) as { data: AdminRoleView };
      setRoles(current => replaceRole(current, body.data));
      setPermissionRole(null);
      router.refresh();
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'The permissions could not be saved.');
    } finally {
      setPending(null);
    }
  }

  async function deleteRole(): Promise<void> {
    if (!deleting) return;

    setPending(`delete:${deleting.id}`);
    clearFailure();

    try {
      await send(`/admin/api/roles/${deleting.id}`, { method: 'DELETE' });
      setRoles(current => current.filter(role => role.id !== deleting.id));
      setDeleting(null);
      router.refresh();
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'The role could not be deleted.');
    } finally {
      setPending(null);
    }
  }

  function renderPermissionCheckboxes(): JSX.Element {
    return (
      <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
        {permissionGroups.map(group => (
          <fieldset key={group.resource} className="space-y-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.resource.replace(/_/g, ' ')}
            </legend>
            {group.options.map(option => {
              const checked = permissionSelection.includes(option.key);

              return (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    value={option.key}
                    aria-label={option.key}
                    checked={checked}
                    onChange={event => togglePermission(option.key, event.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="flex flex-col">
                    <span className="font-mono text-xs text-foreground">{option.key}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Roles & permissions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A role groups the permissions an administrator holds. Super Admin always keeps every
          permission.
        </p>
      </div>

      {error ? (
        <RetryState title="The action could not be completed" description={error} headingLevel={2}>
          <div className="flex justify-center gap-2">
            <RetryButton onRetry={clearFailure} />
            <Button type="button" variant="ghost" onClick={clearFailure}>
              Dismiss
            </Button>
          </div>
        </RetryState>
      ) : null}

      <section aria-labelledby="create-role-heading" className="space-y-3">
        <h2 id="create-role-heading" className="text-sm font-medium text-foreground">
          Create a role
        </h2>
        <form onSubmit={event => void createRole(event)} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label htmlFor="role-name" className="mb-1 block text-xs text-muted-foreground">
              Role name
            </label>
            <Input
              id="role-name"
              value={draft.name}
              onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
              placeholder="content_editor"
              required
              minLength={2}
              maxLength={64}
              pattern="[a-z][a-z0-9_]*"
            />
          </div>
          <div className="min-w-56 flex-1">
            <label htmlFor="role-description" className="mb-1 block text-xs text-muted-foreground">
              Description
            </label>
            <Input
              id="role-description"
              value={draft.description}
              onChange={event =>
                setDraft(current => ({ ...current, description: event.target.value }))
              }
              placeholder="What this role is for"
              maxLength={500}
            />
          </div>
          <Button type="submit" disabled={pending !== null} aria-busy={pending === 'create'}>
            Create role
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Role names use lowercase snake_case, for example <code>content_editor</code>.
        </p>
      </section>

      {roles.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No roles yet"
          description="Create the first role above, then assign the permissions it grants."
          headingLevel={2}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <caption className="text-left text-sm text-muted-foreground">Roles</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Role</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">
                  Description
                </TableHead>
                <TableHead scope="col">Permissions</TableHead>
                <TableHead scope="col" className="hidden sm:table-cell">
                  Users
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map(role => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium text-foreground">{role.name}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {role.description ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {role.grantedPermissionKeys.length}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell tabular-nums text-muted-foreground">
                    {role.userCount}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(role)}
                        aria-label={`Edit role ${role.name}`}
                        disabled={pending !== null}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openPermissions(role)}
                        aria-label={`Manage permissions for ${role.name}`}
                        disabled={pending !== null}
                      >
                        Permissions
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setDeleting(role);
                          clearFailure();
                        }}
                        aria-label={`Delete role ${role.name}`}
                        disabled={pending !== null}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={open => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit role</DialogTitle>
            <DialogDescription>
              Rename the role or change what it is for.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={event => void saveEdit(event)} className="space-y-4">
            <div>
              <label htmlFor="edit-role-name" className="mb-1 block text-xs text-muted-foreground">
                Role name
              </label>
              <Input
                id="edit-role-name"
                value={editDraft.name}
                onChange={event =>
                  setEditDraft(current => ({ ...current, name: event.target.value }))
                }
                required
                minLength={2}
                maxLength={64}
                pattern="[a-z][a-z0-9_]*"
              />
            </div>
            <div>
              <label
                htmlFor="edit-role-description"
                className="mb-1 block text-xs text-muted-foreground"
              >
                Description
              </label>
              <Input
                id="edit-role-description"
                value={editDraft.description}
                onChange={event =>
                  setEditDraft(current => ({ ...current, description: event.target.value }))
                }
                maxLength={500}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending !== null}
                aria-busy={editing !== null && pending === `edit:${editing.id}`}
              >
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={permissionRole !== null}
        onOpenChange={open => {
          if (!open) setPermissionRole(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Role permissions</DialogTitle>
            <DialogDescription>
              {permissionRole
                ? `Choose every permission ${permissionRole.name} grants.`
                : 'Choose every permission the role grants.'}
            </DialogDescription>
          </DialogHeader>
          {renderPermissionCheckboxes()}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPermissionRole(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void savePermissions()}
              disabled={pending !== null}
              aria-busy={
                permissionRole !== null && pending === `permissions:${permissionRole.id}`
              }
            >
              Save permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={open => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => void deleteRole()}
        isPending={pending !== null && deleting !== null && pending === `delete:${deleting.id}`}
        title="Delete role"
        description={
          deleting
            ? `Delete ${deleting.name}. A role that is still assigned to a user cannot be deleted.`
            : 'Delete the role.'
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        variant="destructive"
      />
    </div>
  );
}
