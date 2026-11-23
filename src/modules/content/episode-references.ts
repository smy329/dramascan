import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { isPubliclyPlayableEpisode } from './public-episodes.shared';
import { dramas, episodes, seasons } from './schema';

/**
 * Episode content references.
 *
 * A viewer's progress row points at the drama an episode belongs to, because
 * the progress table stores a drama reference beside the episode reference.
 * The mapping belongs to the content module — it owns the episode hierarchy —
 * so every other module resolves it here instead of reading the episode table
 * directly.
 *
 * There are two levels of reference, and they answer different questions:
 *
 *  - **The administrative reference** (`getEpisodeContentReference`) asks
 *    whether the episode exists and is still in the catalogue. An
 *    administrator attaches subtitle tracks to a draft episode long before it
 *    is published, so this level must not apply the publication rules.
 *  - **The public reference** (`getPublicEpisodeContentReference`) asks
 *    whether the public may actually watch the episode right now. A progress
 *    write or a manual watched-state change that names a guessed episode id of
 *    a draft, unpublished, source-less, or trashed episode is rejected by the
 *    same hierarchy rule the watch page uses.
 *
 * Keeping the two apart is what lets the administration side and the viewer
 * side disagree on purpose without disagreeing by accident.
 */

/** The drama an episode belongs to. */
export type EpisodeContentReference = {
  episodeId: string;
  dramaId: string;
  /**
   * The version of the episode's stored video source.
   *
   * The version moves on whenever an administrator replaces the source. A
   * playback position that refers to an older version belongs to a file that is
   * no longer served, so the caller can refuse to apply it.
   */
  sourceVersion: number;
};

/** The row the two reference levels are decided from. */
type EpisodeReferenceRow = {
  id: string;
  dramaId: string;
  dramaPublicationStatus: string | null;
  dramaDeleted: Date | null;
  dramaStructureType: string | null;
  seasonId: string | null;
  seasonPublicationStatus: string | null;
  seasonDeleted: Date | null;
  episodePublicationStatus: string | null;
  episodeDeleted: Date | null;
  videoSource: string | null;
  sourceVersion: number;
};

/**
 * Read the episode and the state of its ancestors.
 *
 * The episode's drama is joined rather than read separately: the hierarchy is
 * always needed to decide the public level, and one query keeps the decision
 * consistent with the watch page's read.
 */
async function readEpisodeReferenceRow(
  episodeId: string,
  executor: DbExecutor
): Promise<EpisodeReferenceRow | null> {
  const [row] = await executor
    .select({
      id: episodes.id,
      dramaId: episodes.drama_id,
      dramaPublicationStatus: dramas.publication_status,
      dramaDeleted: dramas.deleted_at,
      dramaStructureType: dramas.structure_type,
      seasonId: episodes.season_id,
      seasonPublicationStatus: seasons.publication_status,
      seasonDeleted: seasons.deleted_at,
      episodePublicationStatus: episodes.publication_status,
      episodeDeleted: episodes.deleted_at,
      videoSource: episodes.video_source,
      sourceVersion: episodes.video_source_version,
    })
    .from(episodes)
    .innerJoin(dramas, eq(dramas.id, episodes.drama_id))
    .leftJoin(seasons, eq(seasons.id, episodes.season_id))
    .where(eq(episodes.id, episodeId))
    .limit(1);

  if (!row) {
    return null;
  }

  return row;
}

/**
 * Resolve the drama of an episode that is still in the catalogue.
 *
 * Returns `null` when the episode does not exist or has been moved to the
 * Trash: a trashed episode is not something an administrator manages any
 * more, and it is not something a viewer can make progress in either.
 *
 * This reference does not apply the publication rules. A draft episode still
 * belongs to its drama, and administrative workflows — subtitle management,
 * for example — have to work on an episode before it is published.
 *
 * @param episodeId The episode to resolve.
 * @param executor  Transaction handle to run in; defaults to the pool.
 */
export async function getEpisodeContentReference(
  episodeId: string,
  executor: DbExecutor = db
): Promise<EpisodeContentReference | null> {
  const row = await readEpisodeReferenceRow(episodeId, executor);

  if (!row || row.episodeDeleted !== null) {
    return null;
  }

  return {
    episodeId: row.id,
    dramaId: row.dramaId,
    sourceVersion: row.sourceVersion,
  };
}

/**
 * Resolve the drama of a publicly playable episode.
 *
 * Returns `null` when the episode does not exist, is in the Trash, is not
 * published, has no source, or sits under an unpublished drama or season.
 *
 * A viewer's own record may only point at something the public may watch, so
 * this is the reference the progress write and the manual watched-state
 * change use.
 *
 * @param episodeId The episode to resolve.
 * @param executor  Transaction handle to run in; defaults to the pool.
 */
export async function getPublicEpisodeContentReference(
  episodeId: string,
  executor: DbExecutor = db
): Promise<EpisodeContentReference | null> {
  const row = await readEpisodeReferenceRow(episodeId, executor);

  if (!row || row.episodeDeleted !== null) {
    return null;
  }

  const hasSource = typeof row.videoSource === 'string' && row.videoSource.trim().length > 0;

  const playable = isPubliclyPlayableEpisode({
    episodePublicationStatus: row.episodePublicationStatus,
    episodeDeleted: false,
    hasSource,
    dramaPublicationStatus: row.dramaPublicationStatus,
    dramaDeleted: row.dramaDeleted !== null,
    dramaStructureType: row.dramaStructureType,
    hasSeason: row.seasonId !== null,
    seasonPublicationStatus: row.seasonPublicationStatus,
    seasonDeleted: row.seasonDeleted !== null,
  });

  if (!playable) {
    return null;
  }

  return {
    episodeId: row.id,
    dramaId: row.dramaId,
    sourceVersion: row.sourceVersion,
  };
}
