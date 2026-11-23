/**
 * Users module public API (server-only).
 *
 * The single public surface for the users domain. Keep it narrow: callers get
 * the admin user listing they are allowed to use, not the module's schema or
 * inner helpers.
 */

import 'server-only';

export { listUsersForAdmin } from './read-models/admin-users';
export type {
  AdminUserListItem,
  AdminUserListResult,
  AdminUserRoleAssignment,
} from './read-models/admin-users';
export {
  ADMIN_USER_SORT_FIELDS,
  ADMIN_USER_STATUSES,
  formatSortToken,
  parseAdminUsersQuery,
} from './validation';
export type { AdminUserSortField, AdminUserStatus, AdminUsersQuery } from './validation';

export {
  resetEpisodeWatchState,
  setEpisodeWatchedState,
} from './watch-state';
export type {
  EpisodeWatchStateResetResult,
  SetEpisodeWatchedStateOptions,
  SetEpisodeWatchedStateResult,
} from './watch-state';

export { savePlaybackProgress } from './progress';
export type { PlaybackProgressSaveOptions, PlaybackProgressSaveResult } from './progress';

export {
  getDramaResumePoint,
  getEpisodePlaybackState,
  getMoviePlaybackState,
} from './playback-state';
export type { DramaResumePoint, PlaybackState } from './playback-state';

export { isBookmarked, toggleBookmark } from './bookmarks';
export type { BookmarkTarget } from './bookmarks';

export {
  bookmarkTargetSchema,
  episodeWatchedStateInputSchema,
  parseBookmarkTarget,
  parseEpisodeWatchedStateInput,
  parsePlaybackProgressInput,
} from './validation';
export type {
  BookmarkTargetInput,
  EpisodeWatchedStateInput,
  PlaybackProgressInput,
} from './validation';
