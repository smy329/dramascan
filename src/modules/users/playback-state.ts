import 'server-only';

import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { playback_progress, watched_state } from './schema';

/**
 * Read models for a viewer's own playback state.
 *
 * These are reads only. The authoritative write path is `savePlaybackProgress`;
 * nothing here updates a row. Keeping the reads separate means the watch page,
 * the details page, and the player all derive their "resume" and "watched"
 * decisions from the same stored values instead of each querying the tables in
 * its own way.
 *
 * Every function takes the viewer's id explicitly. The caller resolves the
 * session server-side; a client can never ask for somebody else's position.
 */

/** A viewer's stored position for one episode or movie. */
export type PlaybackState = {
  /** The stored position, in seconds. */
  positionSeconds: number;
  /** The stored duration, in seconds. Zero when it is not known. */
  durationSeconds: number;
  /** Whether the completion threshold has been reached. */
  watched: boolean;
};

/** A resumable position plus the episode it belongs to. */
export type DramaResumePoint = {
  episodeId: string;
  positionSeconds: number;
  durationSeconds: number;
};

type TargetColumn = 'episode_id' | 'movie_id';

async function readPlaybackState(
  userId: string,
  target: TargetColumn,
  id: string,
  executor: DbExecutor
): Promise<PlaybackState | null> {
  const [progress] = await executor
    .select({
      position: playback_progress.position,
      duration: playback_progress.duration,
      completed: playback_progress.completed,
    })
    .from(playback_progress)
    .where(
      and(
        eq(playback_progress.user_id, userId),
        target === 'episode_id'
          ? eq(playback_progress.episode_id, id)
          : eq(playback_progress.movie_id, id)
      )
    )
    .limit(1);

  const [watched] = await executor
    .select({ thresholdMet: watched_state.threshold_met })
    .from(watched_state)
    .where(
      and(
        eq(watched_state.user_id, userId),
        target === 'episode_id'
          ? eq(watched_state.episode_id, id)
          : eq(watched_state.movie_id, id)
      )
    )
    .limit(1);

  if (!progress && !watched) {
    return null;
  }

  return {
    positionSeconds: progress?.position ?? 0,
    durationSeconds: progress?.duration ?? 0,
    watched: watched?.thresholdMet === true || progress?.completed === true,
  };
}

/** Read the stored progress and watched state of one episode. */
export async function getEpisodePlaybackState(
  userId: string | null,
  episodeId: string,
  executor: DbExecutor = db
): Promise<PlaybackState | null> {
  if (userId === null) {
    return null;
  }

  return readPlaybackState(userId, 'episode_id', episodeId, executor);
}

/** Read the stored progress and watched state of one movie. */
export async function getMoviePlaybackState(
  userId: string | null,
  movieId: string,
  executor: DbExecutor = db
): Promise<PlaybackState | null> {
  if (userId === null) {
    return null;
  }

  return readPlaybackState(userId, 'movie_id', movieId, executor);
}

/** One unfinished item of the viewer's Continue Watching list. */
export type ContinueWatchingItem = {
  /** The progress row id. */
  id: string;
  /** The content item the progress belongs to. */
  contentType: 'drama' | 'movie';
  contentId: string;
  /** Set when the item is an episode of a drama. */
  episodeId: string | null;
  /** The stored position, in seconds. */
  positionSeconds: number;
  /** The stored duration, in seconds. */
  durationSeconds: number;
  /** When the viewer last observed this position. */
  lastWatchedAt: Date | null;
};

/**
 * The viewer's unfinished items, most recently watched first.
 *
 * A completed item is not a Continue Watching item, so it is excluded here.
 * Whether the target is still publicly available is decided by the content
 * module; this query only reports what the viewer has not finished.
 */
export async function listContinueWatchingItems(
  userId: string | null,
  executor: DbExecutor = db
): Promise<ContinueWatchingItem[]> {
  if (userId === null) {
    return [];
  }

  const rows = await executor
    .select({
      id: playback_progress.id,
      contentType: playback_progress.content_type,
      contentId: playback_progress.content_id,
      episodeId: playback_progress.episode_id,
      position: playback_progress.position,
      duration: playback_progress.duration,
      lastWatchedAt: playback_progress.last_watched_at,
    })
    .from(playback_progress)
    .where(
      and(
        eq(playback_progress.user_id, userId),
        eq(playback_progress.completed, false),
        gt(playback_progress.position, 0)
      )
    )
    .orderBy(desc(playback_progress.last_watched_at), asc(playback_progress.id));

  return rows.map(row => ({
    id: row.id,
    contentType: row.contentType === 'movie' ? 'movie' : 'drama',
    contentId: row.contentId,
    episodeId: row.episodeId,
    positionSeconds: row.position ?? 0,
    durationSeconds: row.duration ?? 0,
    lastWatchedAt: row.lastWatchedAt,
  }));
}

/**
 * The episode a viewer should resume inside a drama.
 *
 * The most recently watched episode that is not yet complete wins. A completed
 * episode is not a resume point — the viewer finished it — so it is excluded.
 * The content module still decides whether the returned episode is publicly
 * playable; this query only reports what the viewer last watched.
 */
export async function getDramaResumePoint(
  userId: string | null,
  dramaId: string,
  executor: DbExecutor = db
): Promise<DramaResumePoint | null> {
  if (userId === null) {
    return null;
  }

  const [row] = await executor
    .select({
      episodeId: playback_progress.episode_id,
      position: playback_progress.position,
      duration: playback_progress.duration,
    })
    .from(playback_progress)
    .where(
      and(
        eq(playback_progress.user_id, userId),
        eq(playback_progress.drama_id, dramaId),
        sql`${playback_progress.episode_id} is not null`,
        eq(playback_progress.completed, false),
        gt(playback_progress.position, 0)
      )
    )
    .orderBy(desc(playback_progress.last_watched_at), asc(playback_progress.id))
    .limit(1);

  if (!row || row.episodeId === null) {
    return null;
  }

  return {
    episodeId: row.episodeId,
    positionSeconds: row.position ?? 0,
    durationSeconds: row.duration ?? 0,
  };
}
