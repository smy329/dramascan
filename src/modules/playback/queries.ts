import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';

import { playback_failure_reports, subtitle_tracks } from './schema';
import type { SubtitleTrack } from './repository';
import type { SubtitleFormat } from './validation';

/**
 * Playback read models.
 *
 * Two views of the same data: the administrative view carries the internal
 * identifiers, and the public view carries only what a player needs — the
 * language, the label, the URL the browser fetches directly, the format, and
 * whether the track is the default.
 *
 * These are the row-level reads. The module's services add the actor and the
 * permission check on top of them.
 */

/** A subtitle track as the player consumes it. */
export type PublicSubtitleTrack = {
  id: string;
  language: string;
  label: string;
  sourceUrl: string;
  format: SubtitleFormat;
  isDefault: boolean;
};

/** A failure report as the admin list consumes it. */
export type PlaybackFailureListItem = {
  id: string;
  episodeId: string;
  reportedBy: string | null;
  reason: string;
  detail: string | null;
  createdAt: Date;
};

/** Filters for the administrative failure list. */
export type PlaybackFailureQuery = {
  episodeId?: string;
  /** Several episodes at once, for a page that lists a whole drama. */
  episodeIds?: readonly string[];
  limit?: number;
};

/** Map a stored subtitle row onto the module's read model. */
function toSubtitleTrack(row: typeof subtitle_tracks.$inferSelect): SubtitleTrack {
  return {
    id: row.id,
    episodeId: row.episode_id,
    language: row.language,
    label: row.label,
    sourceUrl: row.source_url,
    format: row.format,
    isDefault: row.is_default,
  };
}

/** Read every subtitle track of an episode, ordered by language. */
export async function listSubtitleTrackRows(episodeId: string): Promise<SubtitleTrack[]> {
  const rows = await db
    .select()
    .from(subtitle_tracks)
    .where(eq(subtitle_tracks.episode_id, episodeId))
    .orderBy(subtitle_tracks.language);

  return rows.map(toSubtitleTrack);
}

/**
 * Read the subtitle tracks of several episodes at once.
 *
 * An administrative page lists every episode of a drama. Reading the tracks
 * one episode at a time would issue one query per episode, so the page asks
 * for the whole drama in a single read.
 */
export async function listSubtitleTrackRowsByEpisodeIds(
  episodeIds: readonly string[]
): Promise<SubtitleTrack[]> {
  if (episodeIds.length === 0) {
    return [];
  }

  const rows = await db
    .select()
    .from(subtitle_tracks)
    .where(inArray(subtitle_tracks.episode_id, [...episodeIds]))
    .orderBy(subtitle_tracks.episode_id, subtitle_tracks.language);

  return rows.map(toSubtitleTrack);
}

/**
 * Read the subtitle tracks a viewer may select, ordered by language.
 *
 * This read needs no actor and no permission: the tracks belong to an episode
 * the viewer is already allowed to watch, and the browser fetches the files
 * directly from the external host.
 */
export async function listPublicSubtitleTracks(
  episodeId: string
): Promise<PublicSubtitleTrack[]> {
  const rows = await db
    .select()
    .from(subtitle_tracks)
    .where(eq(subtitle_tracks.episode_id, episodeId))
    .orderBy(subtitle_tracks.language);

  return rows.map(row => ({
    id: row.id,
    language: row.language,
    label: row.label,
    sourceUrl: row.source_url,
    format: row.format,
    isDefault: row.is_default,
  }));
}

/** Read the reported playback failures, newest first. */
export async function listPlaybackFailureRows(
  query: PlaybackFailureQuery = {}
): Promise<PlaybackFailureListItem[]> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);

  const filters = [];

  if (query.episodeId) {
    filters.push(eq(playback_failure_reports.episode_id, query.episodeId));
  }

  if (query.episodeIds && query.episodeIds.length > 0) {
    filters.push(inArray(playback_failure_reports.episode_id, [...query.episodeIds]));
  }

  const rows = await db
    .select()
    .from(playback_failure_reports)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(playback_failure_reports.created_at))
    .limit(limit);

  return rows.map(row => ({
    id: row.id,
    episodeId: row.episode_id,
    reportedBy: row.reported_by,
    reason: row.reason,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}
