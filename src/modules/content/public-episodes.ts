import 'server-only';

import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from '@/db/client';

import {
  isPubliclyPlayableEpisode,
  type PublicEpisodePlayback,
  type PublicEpisodeSummary,
} from './public-episodes.shared';
import { dramas, episodes, seasons } from './schema';

/**
 * Public episode playback lookup.
 *
 * This is the only place that hands a stored video source URL to a viewer.
 * The URL is a public, administrator-supplied direct HTTPS MP4 URL; the
 * application server never fetches, proxies, relays, or rehosts it. The
 * browser requests it directly from the external host.
 *
 * Availability is derived from the complete hierarchy — the episode, its
 * drama, and (for a season-based drama) its season — so a published episode
 * under a draft parent stays stored but is not playable, and a trashed parent
 * never exposes its source.
 */

/** The episode data the watch page needs, and nothing more. */
export type { PublicEpisodePlayback } from './public-episodes.shared';
/** The episode data a listing needs. */
export type { PublicEpisodeSummary } from './public-episodes.shared';
export { isPubliclyPlayableEpisode } from './public-episodes.shared';

/**
 * Read one publicly playable episode.
 *
 * Returns `null` when the episode does not exist, does not belong to the
 * requested drama, or is not publicly playable. The caller decides what a
 * missing episode means for its route.
 */
export async function getPublicEpisodePlayback(
  dramaId: string,
  episodeId: string
): Promise<PublicEpisodePlayback | null> {
  const [row] = await db
    .select({
      id: episodes.id,
      dramaId: episodes.drama_id,
      dramaSlug: dramas.slug,
      dramaTitle: dramas.title,
      dramaStructureType: dramas.structure_type,
      dramaPublicationStatus: dramas.publication_status,
      dramaDeleted: dramas.deleted_at,
      seasonId: episodes.season_id,
      seasonPublicationStatus: seasons.publication_status,
      seasonDeleted: seasons.deleted_at,
      title: episodes.title,
      description: episodes.description,
      episodeNumber: episodes.episode_number,
      episodePublicationStatus: episodes.publication_status,
      episodeDeleted: episodes.deleted_at,
      videoSource: episodes.video_source,
      sourceVersion: episodes.video_source_version,
    })
    .from(episodes)
    .innerJoin(dramas, eq(dramas.id, episodes.drama_id))
    .leftJoin(seasons, eq(seasons.id, episodes.season_id))
    .where(and(eq(episodes.id, episodeId), eq(episodes.drama_id, dramaId)));

  if (!row) {
    return null;
  }

  const source = row.videoSource;

  // A source has to be a real URL: an empty or missing one is not playable.
  if (source === null || source.trim().length === 0) {
    return null;
  }

  const isPlayable = isPubliclyPlayableEpisode({
    episodePublicationStatus: row.episodePublicationStatus,
    episodeDeleted: row.episodeDeleted !== null,
    hasSource: true,
    dramaPublicationStatus: row.dramaPublicationStatus,
    dramaDeleted: row.dramaDeleted !== null,
    dramaStructureType: row.dramaStructureType,
    hasSeason: row.seasonId !== null,
    seasonPublicationStatus: row.seasonPublicationStatus,
    seasonDeleted: row.seasonDeleted !== null,
  });

  if (!isPlayable) {
    return null;
  }

  return {
    id: row.id,
    dramaId: row.dramaId,
    dramaSlug: row.dramaSlug,
    dramaTitle: row.dramaTitle,
    seasonId: row.seasonId,
    title: row.title,
    description: row.description,
    episodeNumber: row.episodeNumber,
    videoSource: source,
    sourceVersion: row.sourceVersion,
  };
}

/**
 * Read the episodes of a drama that are publicly playable.
 *
 * The drama detail page lists them; a trashed or unpublished episode is
 * never part of that list.
 *
 * The listing does not carry the source URL: a list is not a playback view,
 * and only the watch query hands out a media URL.
 */
export async function listPublicDramaEpisodes(
  dramaId: string
): Promise<PublicEpisodeSummary[]> {
  const rows = await db
    .select({
      id: episodes.id,
      dramaId: episodes.drama_id,
      dramaSlug: dramas.slug,
      dramaTitle: dramas.title,
      dramaStructureType: dramas.structure_type,
      dramaPublicationStatus: dramas.publication_status,
      dramaDeleted: dramas.deleted_at,
      seasonId: episodes.season_id,
      seasonPublicationStatus: seasons.publication_status,
      seasonDeleted: seasons.deleted_at,
      title: episodes.title,
      description: episodes.description,
      episodeNumber: episodes.episode_number,
      episodePublicationStatus: episodes.publication_status,
      episodeDeleted: episodes.deleted_at,
      videoSource: episodes.video_source,
    })
    .from(episodes)
    .innerJoin(dramas, eq(dramas.id, episodes.drama_id))
    .leftJoin(seasons, eq(seasons.id, episodes.season_id))
    .where(and(eq(episodes.drama_id, dramaId), isNotNull(episodes.video_source)));

  return rows
    .filter(
      row =>
        typeof row.videoSource === 'string' &&
        row.videoSource.trim().length > 0 &&
        isPubliclyPlayableEpisode({
          episodePublicationStatus: row.episodePublicationStatus,
          episodeDeleted: row.episodeDeleted !== null,
          hasSource: true,
          dramaPublicationStatus: row.dramaPublicationStatus,
          dramaDeleted: row.dramaDeleted !== null,
          dramaStructureType: row.dramaStructureType,
          hasSeason: row.seasonId !== null,
          seasonPublicationStatus: row.seasonPublicationStatus,
          seasonDeleted: row.seasonDeleted !== null,
        })
    )
    .map(row => ({
      id: row.id,
      dramaId: row.dramaId,
      dramaSlug: row.dramaSlug,
      dramaTitle: row.dramaTitle,
      seasonId: row.seasonId,
      title: row.title,
      description: row.description,
      episodeNumber: row.episodeNumber,
    }));
}
