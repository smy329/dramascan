/**
 * Users module public API (server-only).
 *
 * The single public surface for the users domain. Keep it narrow: callers get
 * the admin user listing they are allowed to use, not the module's schema or
 * inner helpers.
 */

import 'server-only';

export { listUsersForAdmin } from './read-models/admin-users';
export type { AdminUserListItem, AdminUserListResult } from './read-models/admin-users';
export {
  ADMIN_USER_SORT_FIELDS,
  ADMIN_USER_STATUSES,
  formatSortToken,
  parseAdminUsersQuery,
} from './validation';
export type { AdminUserSortField, AdminUserStatus, AdminUsersQuery } from './validation';
