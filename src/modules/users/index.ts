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
  listContinueWatchingItems,
} from './playback-state';
export type {
  ContinueWatchingItem,
  DramaResumePoint,
  PlaybackState,
} from './playback-state';

export { isBookmarked, listUserBookmarks, toggleBookmark } from './bookmarks';
export type { BookmarkTarget, UserBookmark } from './bookmarks';

export { listWatchHistoryItems } from './watch-history';
export type { WatchHistoryItem } from './watch-history';

export {
  CONTENT_REPORT_STATUSES,
  listContentReports,
  resolveContentReport,
} from './content-reports';
export type { ContentReport, ContentReportStatus } from './content-reports';

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

export { submitReport } from '@/workflows/users/report-action';
export type {
  ReportReason,
  ReportReasonLabel,
  ReportReasons,
  isValidReportReason,
} from './report-types';
