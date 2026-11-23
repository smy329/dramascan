import 'server-only';

import { requirePermission, type ActorContext } from '@/modules/authorization';
import { getEpisodeContentReference } from '@/modules/content';
import type { DbExecutor } from '@/platform/db/executor';
import { NotFoundError } from '@/platform/errors';

import {
  listPlaybackFailureRows,
  listSubtitleTrackRows,
  listSubtitleTrackRowsByEpisodeIds,
  type PlaybackFailureListItem,
  type PlaybackFailureQuery,
} from './queries';
import {
  deleteSubtitleTrackRow,
  purgeEpisodePlaybackRows,
  recordPlaybackFailureRow,
  upsertSubtitleTrackRow,
  type SubtitleTrack,
} from './repository';
import { parsePlaybackFailureReport, parseSubtitleTrackInput } from './validation';

/**
 * Playback services.
 *
 * The module's public surface: every administrative operation takes the
 * trusted actor as its first argument and re-checks `episode.manage` here, so
 * a caller that forgets the check cannot reach the data. The client is never
 * the authority.
 *
 * The public player read (`listPublicSubtitleTracks`) is deliberately *not*
 * part of this file: it needs no actor and no permission, because a viewer may
 * read the tracks of an episode they are allowed to watch.
 *
 * Every service accepts an optional executor so a workflow can run it inside
 * its own transaction. The module never opens a transaction of its own: the
 * workflow owns the transaction boundary.
 */

/** Permission key for episode and subtitle management. */
const MANAGE_PERMISSION = 'episode.manage';

/**
 * The episode has to exist and must not be in the Trash.
 *
 * The check goes through the content module's public API: the content module
 * owns the episode hierarchy, so nobody else reads the episode table.
 */
async function assertActiveEpisode(episodeId: string, executor?: DbExecutor): Promise<void> {
  const reference = await getEpisodeContentReference(episodeId, executor);

  if (!reference) {
    throw new NotFoundError('Episode not found.');
  }
}

/**
 * Add a subtitle track to an episode, or replace the track of the same
 * language.
 *
 * The track and the episode's previous default are written in the caller's
 * transaction, so a failure never leaves the episode without a default track.
 */
export async function upsertSubtitleTrack(
  actor: ActorContext,
  input: unknown,
  executor?: DbExecutor
): Promise<SubtitleTrack> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsed = parseSubtitleTrackInput(input);
  await assertActiveEpisode(parsed.episodeId, executor);

  return upsertSubtitleTrackRow(parsed, executor);
}

/** Remove one subtitle track of an episode. */
export async function deleteSubtitleTrack(
  actor: ActorContext,
  episodeId: string,
  trackId: string,
  executor?: DbExecutor
): Promise<boolean> {
  requirePermission(actor, MANAGE_PERMISSION);

  return deleteSubtitleTrackRow(episodeId, trackId, executor);
}

/** Read every subtitle track of an episode, ordered by language. */
export async function listSubtitleTracks(
  actor: ActorContext,
  episodeId: string
): Promise<SubtitleTrack[]> {
  requirePermission(actor, MANAGE_PERMISSION);

  return listSubtitleTrackRows(episodeId);
}

/**
 * Read the subtitle tracks of several episodes at once.
 *
 * An administrative page lists every episode of a drama. Reading the tracks
 * one episode at a time would issue one query per episode, so the page asks
 * for the whole drama in a single read.
 */
export async function listSubtitleTracksByEpisodeIds(
  actor: ActorContext,
  episodeIds: readonly string[]
): Promise<SubtitleTrack[]> {
  requirePermission(actor, MANAGE_PERMISSION);

  return listSubtitleTrackRowsByEpisodeIds(episodeIds);
}

/** Read the reported playback failures, newest first. */
export async function listPlaybackFailures(
  actor: ActorContext,
  query: PlaybackFailureQuery = {}
): Promise<PlaybackFailureListItem[]> {
  requirePermission(actor, MANAGE_PERMISSION);

  return listPlaybackFailureRows(query);
}

/**
 * Record a viewer-reported playback failure.
 *
 * The report describes the failure and never carries the source URL: the
 * report is a complaint about a source, not a copy of it.
 *
 * The reporter is the actor's own identity — resolved from the session on the
 * server — so a client can never report a failure on behalf of somebody else.
 * An anonymous viewer may report a failure too: the report is still useful.
 */
export async function recordPlaybackFailure(
  actor: ActorContext,
  input: unknown,
  executor?: DbExecutor
): Promise<{ id: string }> {
  const parsed = parsePlaybackFailureReport(input);

  const report = await recordPlaybackFailureRow(parsed, actor.userId, executor);

  return { id: report.id };
}

/**
 * Remove the playback rows of the given episodes.
 *
 * A permanent episode deletion has to remove the subtitle tracks and the
 * failure reports of that episode. The rows belong to this module, so this
 * module removes them: the deletion workflow asks for the cleanup instead of
 * deleting another module's tables itself.
 *
 * The operation runs inside the caller's transaction, so the rows disappear
 * together with the episode they belong to.
 */
export async function purgeEpisodePlaybackReferences(
  actor: ActorContext,
  episodeIds: readonly string[],
  executor?: DbExecutor
): Promise<{ subtitleTracks: number; failureReports: number }> {
  requirePermission(actor, MANAGE_PERMISSION);

  return purgeEpisodePlaybackRows(episodeIds, executor);
}
