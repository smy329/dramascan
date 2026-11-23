/**
 * Playback module public API (server-only).
 *
 * The single public surface for the playback domain. Callers get the
 * subtitle-track and failure-report services they are allowed to use, not the
 * module's schema or inner helpers.
 *
 * Every administrative service takes the trusted actor as its first argument
 * and re-checks `episode.manage` itself: the client is never the authority.
 *
 * Scope note: the browser fetches subtitle files directly from the external
 * host. The server stores and validates the metadata; it never downloads,
 * converts, or rehosts a subtitle file.
 */

import 'server-only';

export {
  SUBTITLE_FORMATS,
  PLAYBACK_FAILURE_REASONS,
  parsePlaybackFailureReport,
  parseSubtitleTrackInput,
  subtitleFormatSchema,
  subtitleSourceUrlSchema,
  subtitleTrackInputSchema,
  playbackFailureReasonSchema,
  playbackFailureReportSchema,
} from './validation';

export type {
  PlaybackFailureReason,
  PlaybackFailureReportInput,
  SubtitleFormat,
  SubtitleTrackInput,
} from './validation';

export {
  deleteSubtitleTrack,
  listPlaybackFailures,
  listSubtitleTracks,
  listSubtitleTracksByEpisodeIds,
  purgeEpisodePlaybackReferences,
  recordPlaybackFailure,
  upsertSubtitleTrack,
} from './service';

export { listPublicSubtitleTracks } from './queries';

export type {
  PlaybackFailureListItem,
  PlaybackFailureQuery,
  PublicSubtitleTrack,
} from './queries';

export type { SubtitleTrack } from './repository';
