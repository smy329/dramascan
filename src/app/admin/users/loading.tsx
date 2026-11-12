import type { JSX } from 'react';

import { AdminTableSkeleton } from '@/components/admin/data-table/data-table-skeleton';

export default function AdminUsersLoading(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Users</h1>
      </div>
      <AdminTableSkeleton columns={5} label="Loading users" />
    </div>
  );
}
