import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { playback_failure_reports, subtitle_tracks } from './schema';
import { parsePlaybackFailureReport, parseSubtitleTrackInput, type SubtitleFormat } from './validation';

/**
 * Playback persistence.
 *
 * The repository owns the module's tables. It is the only place that writes
 * `subtitle_tracks` and `playback_failure_reports`.
 *
 * Every write goes through the module's validation, so an invalid value can
 * never reach the database even when the caller is not a Server Action.
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
 */
export async function upsertSubtitleTrack(
  input: unknown,
  executor: DbExecutor = db
): Promise<SubtitleTrack> {
  const parsed = parseSubtitleTrackInput(input);

  const existing = await executor
    .select()
    .from(subtitle_tracks)
    .where(
      and(
        eq(subtitle_tracks.episode_id, parsed.episodeId),
        eq(subtitle_tracks.language, parsed.language)
      )
    )
    .limit(1);

  if (parsed.isDefault) {
    await executor
      .update(subtitle_tracks)
      .set({ is_default: false })
      .where(
        and(
          eq(subtitle_tracks.episode_id, parsed.episodeId),
          eq(subtitle_tracks.is_default, true)
        )
      );
  }

  const values = {
    episode_id: parsed.episodeId,
    language: parsed.language,
    label: parsed.label,
    source_url: parsed.sourceUrl,
    format: parsed.format,
    is_default: parsed.isDefault,
  };

  const row = existing[0]
    ? await executor
        .update(subtitle_tracks)
        .set(values)
        .where(eq(subtitle_tracks.id, existing[0].id))
        .returning()
    : await executor.insert(subtitle_tracks).values(values).returning();

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
export async function deleteSubtitleTrack(
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
export async function recordPlaybackFailure(
  input: unknown,
  reportedBy: string | null = null,
  executor: DbExecutor = db
): Promise<PlaybackFailureReport> {
  const parsed = parsePlaybackFailureReport(input);

  const [row] = await executor
    .insert(playback_failure_reports)
    .values({
      episode_id: parsed.episodeId,
      reported_by: reportedBy,
      reason: parsed.reason,
      detail: parsed.detail ?? null,
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
