/**
 * Auth module public API (server-only).
 *
 * The single public surface for the authentication and identity domain. Keep
 * it narrow: callers get identity reads and status changes they are allowed
 * to use, not the module's schema or inner helpers.
 */

import 'server-only';

export { USER_ACCOUNT_SORT_FIELDS, USER_ACCOUNT_STATUSES, listUserAccounts } from './repository';

export type {
  ListUserAccountsQuery,
  UserAccountPage,
  UserAccountRow,
  UserAccountSortField,
  UserAccountStatus,
} from './repository';
