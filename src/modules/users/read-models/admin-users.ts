/**
 * Admin user listing read model (owned by `users`).
 *
 * This is the approved cross-module read model for the admin user listing
 * over the `auth` identity table (`ARCHITECTURE.md` §8.4, D-011). It reads no
 * other module's table directly: the identity rows come from the auth
 * module's public API.
 *
 * Authorization is enforced here, not only at the entrypoint, so the listing
 * cannot be reached without the canonical `user.read` permission.
 */

import { requirePermission, toPermissionKey, type ActorContext } from '@/modules/authorization';
import { listUserAccounts } from '@/modules/auth';

import type { AdminUserStatus, AdminUsersQuery } from '../validation';

export type AdminUserListItem = {
  id: string;
  name: string;
  email: string;
  status: AdminUserStatus;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserListResult = {
  items: readonly AdminUserListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

/** Deleted wins over the active flag, so a trashed account is never "active". */
function resolveStatus(isActive: boolean, deletedAt: Date | null): AdminUserStatus {
  if (deletedAt !== null) {
    return 'deleted';
  }

  return isActive ? 'active' : 'deactivated';
}

/**
 * Read one page of user accounts for the administration area.
 *
 * Throws `AuthenticationError` for an anonymous actor and `AuthorizationError`
 * for an actor without `user.read`, before any query runs.
 */
export async function listUsersForAdmin(
  actor: ActorContext,
  query: AdminUsersQuery
): Promise<AdminUserListResult> {
  requirePermission(actor, toPermissionKey('user', 'read'));

  const result = await listUserAccounts({
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    search: query.search.length > 0 ? query.search : null,
    status: query.status,
    isSuperAdmin: query.superAdmin,
  });

  const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / query.pageSize);

  return {
    items: result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: resolveStatus(row.isActive, row.deletedAt),
      isSuperAdmin: row.isSuperAdmin,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: result.total,
    totalPages,
    hasNextPage: query.page < totalPages,
    hasPreviousPage: query.page > 1 && totalPages > 0,
  };
}
