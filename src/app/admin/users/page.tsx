import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { formatSortToken, listUsersForAdmin, parseAdminUsersQuery } from '@/modules/users';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/users';

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  isSuperAdmin: boolean;
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

const STATUS_LABELS: Record<string, string> = {
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

function formatSuperAdmin(row: AdminUserRow): string {
  return row.isSuperAdmin ? 'Yes' : 'No';
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

  const state: TableQueryState = {
    page: query.page,
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
      render: formatSuperAdmin,
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
