import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { playback_failure_reports, subtitle_tracks } from './schema';
import type { SubtitleFormat } from './validation';

/**
 * Playback persistence.
 *
 * The repository owns the module's tables. It is the only place that writes
 * `subtitle_tracks` and `playback_failure_reports`.
 *
 * The functions here are the row-level primitives: they take an already
 * validated value and an optional executor. The module's services own the
 * validation and the authorization, so a caller can never reach a write with
 * an unvalidated payload — and a workflow can run the write inside its own
 * transaction by passing the transaction handle as the executor.
 */

/** A stored subtitle track. */
export type SubtitleTrack = {
  id: string;
  episodeId: string;
  language: string;
  label: string;
  sourceUrl: string;
  format: SubtitleFormat;
  isDefault: boolean;
};

/** A stored playback-failure report. */
export type PlaybackFailureReport = {
  id: string;
  episodeId: string;
  reportedBy: string | null;
  reason: string;
  detail: string | null;
  createdAt: Date;
};

/** The values of a subtitle track that is written to the database. */
export type SubtitleTrackValues = {
  episodeId: string;
  language: string;
  label: string;
  sourceUrl: string;
  format: SubtitleFormat;
  isDefault: boolean;
};

/** The values of a playback-failure report that is written to the database. */
export type PlaybackFailureReportValues = {
  episodeId: string;
  reason: string;
  detail?: string | undefined;
};

/**
 * Create or replace the subtitle track for one language of an episode.
 *
 * There is one track per language per episode: adding a track for a language
 * that already has one updates that track instead of stacking duplicates.
 *
 * When the new track becomes the default, the episode's previous default is
 * demoted first. The database also enforces "at most one default per
 * episode" with a partial unique index; demoting first keeps that index from
 * rejecting a legitimate change.
 *
 * The two writes belong together: an episode must never end up with two
 * default tracks, or with none. The caller therefore runs this inside one
 * transaction — the workflow owns that boundary.
 */
export async function upsertSubtitleTrackRow(
  values: SubtitleTrackValues,
  executor: DbExecutor = db
): Promise<SubtitleTrack> {
  const existing = await executor
    .select()
    .from(subtitle_tracks)
    .where(
      and(
        eq(subtitle_tracks.episode_id, values.episodeId),
        eq(subtitle_tracks.language, values.language)
      )
    )
    .limit(1);

  if (values.isDefault) {
    await executor
      .update(subtitle_tracks)
      .set({ is_default: false })
      .where(
        and(
          eq(subtitle_tracks.episode_id, values.episodeId),
          eq(subtitle_tracks.is_default, true)
        )
      );
  }

  const row = existing[0]
    ? await executor
        .update(subtitle_tracks)
        .set({
          label: values.label,
          source_url: values.sourceUrl,
          format: values.format,
          is_default: values.isDefault,
        })
        .where(eq(subtitle_tracks.id, existing[0].id))
        .returning()
    : await executor
        .insert(subtitle_tracks)
        .values({
          episode_id: values.episodeId,
          language: values.language,
          label: values.label,
          source_url: values.sourceUrl,
          format: values.format,
          is_default: values.isDefault,
        })
        .returning();

  const stored = row[0];

  if (!stored) {
    throw new Error('Subtitle track write returned no row.');
  }

  return {
    id: stored.id,
    episodeId: stored.episode_id,
    language: stored.language,
    label: stored.label,
    sourceUrl: stored.source_url,
    format: stored.format,
    isDefault: stored.is_default,
  };
}

/**
 * Remove one subtitle track.
 *
 * The episode is part of the lookup so a track id from another episode can
 * never delete this episode's track.
 */
export async function deleteSubtitleTrackRow(
  episodeId: string,
  trackId: string,
  executor: DbExecutor = db
): Promise<boolean> {
  const deleted = await executor
    .delete(subtitle_tracks)
    .where(and(eq(subtitle_tracks.id, trackId), eq(subtitle_tracks.episode_id, episodeId)))
    .returning({ id: subtitle_tracks.id });

  return deleted.length > 0;
}

/**
 * Record a viewer-reported playback failure.
 *
 * The report describes the failure and never carries the source URL: the
 * report is a complaint about a source, not a copy of it.
 *
 * The reporter is a separate argument, not part of the report payload: the
 * reporter is resolved from the session on the server, so a client can never
 * report a failure on behalf of somebody else.
 */
export async function recordPlaybackFailureRow(
  values: PlaybackFailureReportValues,
  reportedBy: string | null = null,
  executor: DbExecutor = db
): Promise<PlaybackFailureReport> {
  const [row] = await executor
    .insert(playback_failure_reports)
    .values({
      episode_id: values.episodeId,
      reported_by: reportedBy,
      reason: values.reason,
      detail: values.detail ?? null,
    })
    .returning();

  if (!row) {
    throw new Error('Playback failure report insert returned no row.');
  }

  return {
    id: row.id,
    episodeId: row.episode_id,
    reportedBy: row.reported_by,
    reason: row.reason,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

/**
 * Remove the playback rows of the given episodes.
 *
 * A permanent episode deletion has to remove the subtitle tracks and the
 * failure reports of that episode. The rows belong to this module, so this
 * module removes them — a content deletion never reaches into another
 * module's tables.
 *
 * The two tables have a restrictive foreign key to the episode, so the rows
 * have to be gone before the episode itself is deleted. The caller runs both
 * in one transaction.
 */
export async function purgeEpisodePlaybackRows(
  episodeIds: readonly string[],
  executor: DbExecutor = db
): Promise<{ subtitleTracks: number; failureReports: number }> {
  if (episodeIds.length === 0) {
    return { subtitleTracks: 0, failureReports: 0 };
  }

  const ids = [...episodeIds];

  const deletedTracks = await executor
    .delete(subtitle_tracks)
    .where(inArray(subtitle_tracks.episode_id, ids))
    .returning({ id: subtitle_tracks.id });

  const deletedReports = await executor
    .delete(playback_failure_reports)
    .where(inArray(playback_failure_reports.episode_id, ids))
    .returning({ id: playback_failure_reports.id });

  return {
    subtitleTracks: deletedTracks.length,
    failureReports: deletedReports.length,
  };
}
