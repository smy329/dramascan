import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { UserManagementControls } from '@/components/admin/users/user-management-controls';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import {
  formatSortToken,
  listUsersForAdmin,
  parseAdminUsersQuery,
  type AdminUserStatus,
} from '@/modules/users';
import { listRolesForAdmin } from '@/workflows/admin/roles';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import type { AdminAssignableRoleView } from '@/lib/contracts/admin-authorization';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/users';

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  status: AdminUserStatus;
  isSuperAdmin: boolean;
  roles: readonly { roleId: string; roleName: string; assignedAt: string }[];
  createdAt: string;
};

const STATUS_OPTIONS = [
  { value: '', label: 'Active & deactivated' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'deleted', label: 'Deleted' },
] as const;

const SUPER_ADMIN_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

const STATUS_LABELS: Record<AdminUserStatus, string> = {
  active: 'Active',
  deactivated: 'Deactivated',
  deleted: 'Deleted',
};

function formatDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function formatStatus(row: AdminUserRow): string {
  return STATUS_LABELS[row.status] ?? row.status;
}

function renderSuperAdmin(row: AdminUserRow): string {
  return row.isSuperAdmin ? 'Yes' : 'No';
}

function renderRoles(row: AdminUserRow): JSX.Element {
  if (row.roles.length === 0) {
    return <span className="text-xs text-muted-foreground">No roles</span>;
  }

  return (
    <ul className="flex flex-wrap gap-1" aria-label={`Roles of ${row.name}`}>
      {row.roles.map(role => (
        <li
          key={role.roleId}
          className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
        >
          {role.roleName}
        </li>
      ))}
    </ul>
  );
}

function renderEmptyState(hasActiveFilter: boolean): JSX.Element {
  if (hasActiveFilter) {
    return (
      <p className="text-sm text-muted-foreground">
        No accounts match the current search and filters.
      </p>
    );
  }

  return <p className="text-sm text-muted-foreground">No accounts exist yet.</p>;
}

export default async function AdminUsersPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // The navigation is never the boundary: the page checks the canonical
  // permission itself, and the query service checks it again.
  if (!hasPermission(actor, toPermissionKey('user', 'read'))) {
    notFound();
  }

  const raw = await searchParams;
  const query = parseAdminUsersQuery(raw);
  const result = await listUsersForAdmin(actor, query);

  // Role assignment grants access, so it is Super Admin only. Account status
  // keeps the canonical `admin.manage` requirement, and the API refuses a
  // change to a Super Admin account by a non-Super-Admin. Terminating the
  // sessions signs the account out of every device, so it is Super Admin only
  // as well.
  const canManageRoles = actor.isSuperAdmin;
  const canManageStatus = hasPermission(actor, toPermissionKey('admin', 'manage'));
  const canManageSessions = actor.isSuperAdmin;

  const availableRoles: readonly AdminAssignableRoleView[] = canManageRoles
    ? (await listRolesForAdmin(actor)).map(role => ({ id: role.id, name: role.name }))
    : [];

  // The summary, the page window, and every generated link follow the page the
  // read model resolved, not the one the URL asked for: a page past the last
  // one is clamped, so a shared or bookmarked link never renders an inverted
  // range or a link to a page that does not exist.
  const state: TableQueryState = {
    page: result.page,
    pageSize: query.pageSize,
    sort: formatSortToken(query.sortBy, query.sortDirection),
    search: query.search,
    filters: {
      status: query.status ?? '',
      superAdmin: query.superAdmin === null ? '' : query.superAdmin ? 'yes' : 'no',
    },
  };

  const columns: readonly AdminTableColumn<AdminUserRow>[] = [
    { key: 'name', header: 'Name', sortKey: 'name', render: row => row.name },
    { key: 'email', header: 'Email', sortKey: 'email', visibility: 'sm', render: row => row.email },
    {
      key: 'status',
      header: 'Status',
      render: formatStatus,
    },
    {
      key: 'superAdmin',
      header: 'Super Admin',
      visibility: 'md',
      render: renderSuperAdmin,
    },
    {
      key: 'roles',
      header: 'Roles',
      visibility: 'md',
      render: renderRoles,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: row => (
        <UserManagementControls
          user={{
            id: row.id,
            name: row.name,
            status: row.status,
            isSuperAdmin: row.isSuperAdmin,
            roles: row.roles,
          }}
          availableRoles={availableRoles}
          canManageStatus={canManageStatus}
          canManageRoles={canManageRoles}
          canManageSessions={canManageSessions}
        />
      ),
    },
    {
      key: 'created',
      header: 'Created',
      sortKey: 'createdAt',
      visibility: 'lg',
      render: row => formatDate(row.createdAt),
    },
  ];

  const hasActiveFilter =
    query.search.length > 0 || query.status !== null || query.superAdmin !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounts created by people signing in with Google.
        </p>
      </div>

      <AdminTableToolbar
        pathname={PATHNAME}
        state={state}
        searchLabel="Search users"
        searchPlaceholder="Name or email"
        clearHref={buildTableHref(PATHNAME, state, { page: 1, search: '', filters: {} })}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: STATUS_OPTIONS,
            value: state.filters.status ?? '',
          },
          {
            name: 'superAdmin',
            label: 'Super Admin',
            options: SUPER_ADMIN_OPTIONS,
            value: state.filters.superAdmin ?? '',
          },
        ]}
      />

      <AdminDataTable
        caption="User accounts"
        columns={columns}
        rows={result.items}
        rowKey={row => row.id}
        pathname={PATHNAME}
        state={state}
        empty={renderEmptyState(hasActiveFilter)}
      />

      <AdminTablePagination
        pathname={PATHNAME}
        state={state}
        total={result.total}
        totalPages={result.totalPages}
        itemLabel="users"
      />
    </div>
  );
}
