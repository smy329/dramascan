/**
 * Auth module public API (server-only).
 *
 * The single public surface for the authentication and identity domain. Keep
 * it narrow: callers get identity reads and status changes they are allowed
 * to use, not the module's schema or inner helpers.
 */

import 'server-only';

export {
  USER_ACCOUNT_SORT_FIELDS,
  USER_ACCOUNT_STATUSES,
  getUserAccount,
  listUserAccounts,
  setUserAccountActive,
} from './repository';

export {
  DEFAULT_AUDIENCE_LIMIT,
  MAX_AUDIENCE_LIMIT,
  listActiveAccountIds,
} from './audience';

export { getUserDisplayName, getUserDisplayNames } from './display-names';

export type {
  ListUserAccountsQuery,
  UserAccountPage,
  UserAccountRecord,
  UserAccountRow,
  UserAccountSortField,
  UserAccountStatus,
} from './repository';
