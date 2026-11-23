/**
 * Playback module public API (server-only).
 *
 * The single public surface for the playback domain. Callers get the
 * subtitle-track and failure-report services they are allowed to use, not the
 * module's schema or inner helpers.
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
  listPublicSubtitleTracks,
  listSubtitleTracks,
  listSubtitleTracksByEpisodeIds,
  recordPlaybackFailure,
  upsertSubtitleTrack,
} from './queries';

export type {
  PlaybackFailureListItem,
  PlaybackFailureQuery,
  PublicSubtitleTrack,
  PlaybackFailureReport,
  SubtitleTrack,
} from './queries';
