import 'server-only';

import { and, count, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { db } from '@/db/client';

import { bookmarks, playback_progress, watched_state, watch_history } from './schema';

/**
 * User-facing content references that must follow a content identity when it
 * changes type (drama → movie). The `users` module owns these writes; callers
 * pass their transaction so the move is atomic with the conversion.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = Tx | typeof db;

export type ContentReferenceType = 'drama' | 'movie';

export type UserContentReferenceCounts = {
  bookmarks: number;
  playbackProgress: number;
  watchedState: number;
  watchHistory: number;
};

/** The columns that identify the target of a user-content row. */
type TargetColumns = {
  drama_id: AnyPgColumn;
  movie_id: AnyPgColumn;
  content_type: AnyPgColumn;
  content_id: AnyPgColumn;
};

/**
 * Match the rows that point at one content item.
 *
 * The typed target is authoritative: a row that names the target through
 * `drama_id`/`movie_id` belongs to it even when its legacy pair names
 * something else. A row that has no typed target at all falls back to the
 * legacy pair. The two cases are mutually exclusive, so a row is never
 * counted twice and never moved twice.
 */
function matchesTarget(columns: TargetColumns, type: ContentReferenceType, id: string): SQL {
  const typed = type === 'drama' ? eq(columns.drama_id, id) : eq(columns.movie_id, id);
  const legacy = and(
    isNull(columns.drama_id),
    isNull(columns.movie_id),
    eq(columns.content_type, type),
    eq(columns.content_id, id)
  );

  return or(typed, legacy) as SQL;
}

/**
 * The values that make a row point at a content item.
 *
 * Both representations are written together: the typed columns satisfy the
 * exactly-one check, and the legacy pair stays in step for the reconciliation
 * window in which it is still the only evidence for older rows.
 */
function targetValues(type: ContentReferenceType, id: string) {
  return {
    drama_id: type === 'drama' ? id : null,
    movie_id: type === 'movie' ? id : null,
    content_type: type,
    content_id: id,
  };
}

/** Group rows by their owner, keeping a stable order inside every group. */
function groupByUser<T extends { id: string; user_id: string }>(
  rows: readonly T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const group = grouped.get(row.user_id) ?? [];
    group.push(row);
    grouped.set(row.user_id, group);
  }

  return grouped;
}

/** Count the bookmark/progress/history rows pointing at one content item. */
export async function countContentReferences(
  tx: DbOrTx,
  type: ContentReferenceType,
  id: string
): Promise<UserContentReferenceCounts> {
  // The queries run one after the other: a transaction uses a single
  // PostgreSQL connection, and the driver does not accept two queries on the
  // same connection at the same time.
  const [bookmarkRow] = await tx
    .select({ total: count() })
    .from(bookmarks)
    .where(matchesTarget(bookmarks, type, id));
  const [progressRow] = await tx
    .select({ total: count() })
    .from(playback_progress)
    .where(matchesTarget(playback_progress, type, id));
  const [watchedRow] = await tx
    .select({ total: count() })
    .from(watched_state)
    .where(matchesTarget(watched_state, type, id));
  const [historyRow] = await tx
    .select({ total: count() })
    .from(watch_history)
    .where(matchesTarget(watch_history, type, id));

  return {
    bookmarks: Number(bookmarkRow?.total ?? 0),
    playbackProgress: Number(progressRow?.total ?? 0),
    watchedState: Number(watchedRow?.total ?? 0),
    watchHistory: Number(historyRow?.total ?? 0),
  };
}

/**
 * Move every user reference from one content item to another.
 *
 * Playback progress and watched state are current movie-level state, so their
 * episode id is cleared. Watch history keeps the episode id as a historical
 * fact; the episode row itself is soft-deleted, never removed.
 *
 * Moving a drama onto a movie can make several rows of one user point at the
 * same target. The per-user/per-target uniqueness would reject that, so the
 * duplicates are merged first and the surviving row is retargeted.
 */
export async function moveContentReferences(
  tx: Tx,
  from: { type: ContentReferenceType; id: string },
  to: { type: ContentReferenceType; id: string }
): Promise<void> {
  await moveBookmarks(tx, from, to);
  await movePlaybackProgress(tx, from, to);
  await moveWatchedState(tx, from, to);
  await moveWatchHistory(tx, from, to);
}

/**
 * Move the bookmarks.
 *
 * A bookmark carries no state beyond its target, so one row per user survives:
 * the row that already pointed at the target if there is one, otherwise the
 * first source row in a stable order.
 */
async function moveBookmarks(
  tx: Tx,
  from: { type: ContentReferenceType; id: string },
  to: { type: ContentReferenceType; id: string }
): Promise<void> {
  const sourceRows = await tx
    .select({ id: bookmarks.id, user_id: bookmarks.user_id })
    .from(bookmarks)
    .where(matchesTarget(bookmarks, from.type, from.id));

  if (sourceRows.length === 0) {
    return;
  }

  const targetRows = await tx
    .select({ id: bookmarks.id, user_id: bookmarks.user_id })
    .from(bookmarks)
    .where(matchesTarget(bookmarks, to.type, to.id));

  const targetByUser = new Map(targetRows.map(row => [row.user_id, row]));
  const doomed = new Set<string>();
  const survivors: string[] = [];

  for (const [userId, rows] of groupByUser(sourceRows)) {
    const existing = targetByUser.get(userId);
    const survivor =
      existing ?? [...rows].sort((left, right) => left.id.localeCompare(right.id))[0]!;

    survivors.push(survivor.id);

    for (const row of rows) {
      if (row.id !== survivor.id) {
        doomed.add(row.id);
      }
    }
  }

  if (doomed.size > 0) {
    await tx.delete(bookmarks).where(inArray(bookmarks.id, [...doomed]));
  }

  if (survivors.length > 0) {
    await tx
      .update(bookmarks)
      .set(targetValues(to.type, to.id))
      .where(inArray(bookmarks.id, survivors));
  }
}

/**
 * Move the playback progress.
 *
 * Progress is a resume point, not a log, so one row per user and target
 * survives. The resume point of the most recently watched row wins, and the
 * merged row is complete when any of the merged rows was complete.
 */
async function movePlaybackProgress(
  tx: Tx,
  from: { type: ContentReferenceType; id: string },
  to: { type: ContentReferenceType; id: string }
): Promise<void> {
  const columns = {
    id: playback_progress.id,
    user_id: playback_progress.user_id,
    position: playback_progress.position,
    duration: playback_progress.duration,
    last_watched_at: playback_progress.last_watched_at,
    completed: playback_progress.completed,
  };

  const sourceRows = await tx
    .select(columns)
    .from(playback_progress)
    .where(matchesTarget(playback_progress, from.type, from.id));

  if (sourceRows.length === 0) {
    return;
  }

  const targetRows = await tx
    .select(columns)
    .from(playback_progress)
    .where(matchesTarget(playback_progress, to.type, to.id));

  const targetByUser = new Map(targetRows.map(row => [row.user_id, row]));
  const doomed = new Set<string>();
  const updates: { id: string; values: Record<string, unknown> }[] = [];

  for (const [userId, rows] of groupByUser(sourceRows)) {
    const existing = targetByUser.get(userId);
    const merged = existing ? [...rows, existing] : rows;
    const latest = merged.reduce((best, row) => (isLater(row, best) ? row : best));
    const survivor = existing ?? latest;

    for (const row of merged) {
      if (row.id !== survivor.id) {
        doomed.add(row.id);
      }
    }

    updates.push({
      id: survivor.id,
      values: {
        ...targetValues(to.type, to.id),
        episode_id: null,
        position: latest.position,
        duration: latest.duration,
        last_watched_at: latest.last_watched_at,
        completed: merged.some(row => row.completed === true),
      },
    });
  }

  if (doomed.size > 0) {
    await tx.delete(playback_progress).where(inArray(playback_progress.id, [...doomed]));
  }

  for (const update of updates) {
    await tx
      .update(playback_progress)
      .set(update.values)
      .where(eq(playback_progress.id, update.id));
  }
}

/**
 * Move the watched state.
 *
 * The merged row keeps the most watched minutes, is complete when any merged
 * row met the threshold, and carries the earliest completion and the latest
 * reset, so the history of the watched state is not lost.
 */
async function moveWatchedState(
  tx: Tx,
  from: { type: ContentReferenceType; id: string },
  to: { type: ContentReferenceType; id: string }
): Promise<void> {
  const columns = {
    id: watched_state.id,
    user_id: watched_state.user_id,
    watched_minutes: watched_state.watched_minutes,
    threshold_met: watched_state.threshold_met,
    last_watched_at: watched_state.last_watched_at,
    completed_at: watched_state.completed_at,
    completed_at_reset_at: watched_state.completed_at_reset_at,
  };

  const sourceRows = await tx
    .select(columns)
    .from(watched_state)
    .where(matchesTarget(watched_state, from.type, from.id));

  if (sourceRows.length === 0) {
    return;
  }

  const targetRows = await tx
    .select(columns)
    .from(watched_state)
    .where(matchesTarget(watched_state, to.type, to.id));

  const targetByUser = new Map(targetRows.map(row => [row.user_id, row]));
  const doomed = new Set<string>();
  const updates: { id: string; values: Record<string, unknown> }[] = [];

  for (const [userId, rows] of groupByUser(sourceRows)) {
    const existing = targetByUser.get(userId);
    const merged = existing ? [...rows, existing] : rows;
    const latest = merged.reduce((best, row) => (isLater(row, best) ? row : best));
    const survivor = existing ?? latest;

    for (const row of merged) {
      if (row.id !== survivor.id) {
        doomed.add(row.id);
      }
    }

    const minutes = merged
      .map(row => row.watched_minutes)
      .filter((value): value is number => value !== null);
    const completedAt =
      merged
        .map(row => row.completed_at)
        .filter((value): value is Date => value !== null)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    const resetAt =
      merged
        .map(row => row.completed_at_reset_at)
        .filter((value): value is Date => value !== null)
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

    updates.push({
      id: survivor.id,
      values: {
        ...targetValues(to.type, to.id),
        episode_id: null,
        watched_minutes: minutes.length > 0 ? Math.max(...minutes) : null,
        threshold_met: merged.some(row => row.threshold_met === true),
        last_watched_at: latest.last_watched_at,
        completed_at: completedAt,
        completed_at_reset_at: resetAt,
      },
    });
  }

  if (doomed.size > 0) {
    await tx.delete(watched_state).where(inArray(watched_state.id, [...doomed]));
  }

  for (const update of updates) {
    await tx.update(watched_state).set(update.values).where(eq(watched_state.id, update.id));
  }
}

/**
 * Move the watch history.
 *
 * History is append-only: every session stays its own row, so nothing is
 * merged and the historical episode id is kept.
 */
async function moveWatchHistory(
  tx: Tx,
  from: { type: ContentReferenceType; id: string },
  to: { type: ContentReferenceType; id: string }
): Promise<void> {
  await tx
    .update(watch_history)
    .set(targetValues(to.type, to.id))
    .where(matchesTarget(watch_history, from.type, from.id));
}

/**
 * Order two rows by recency.
 *
 * The most recent row wins; rows with the same instant are ordered by id, so
 * the result never depends on the order the rows came back in.
 */
function isLater(
  candidate: { id: string; last_watched_at: Date },
  current: { id: string; last_watched_at: Date }
): boolean {
  const difference = candidate.last_watched_at.getTime() - current.last_watched_at.getTime();

  if (difference !== 0) {
    return difference > 0;
  }

  return candidate.id < current.id;
}

/**
 * Remove every user row that points at content that is being permanently
 * deleted.
 *
 * Bookmarks, playback progress, watched state, and watch history are personal
 * records of the deleted content: once the content is gone they have nothing
 * left to describe, so they are removed rather than kept as dangling
 * references.
 *
 * `episodeIds` are the episodes that are deleted with the content. Episode
 * rows carry their own user references, and those rows are removed as well.
 */
export async function purgeContentReferences(
  tx: Tx,
  type: ContentReferenceType,
  id: string,
  episodeIds: readonly string[] = []
): Promise<UserContentReferenceCounts> {
  const target = matchesTarget(bookmarks, type, id);
  const progressTarget = matchesTarget(playback_progress, type, id);
  const watchedTarget = matchesTarget(watched_state, type, id);
  const historyTarget = matchesTarget(watch_history, type, id);

  const bookmarkRows = await tx
    .delete(bookmarks)
    .where(target)
    .returning({ id: bookmarks.id });

  const progressRows = await tx
    .delete(playback_progress)
    .where(
      episodeIds.length > 0
        ? or(progressTarget, inArray(playback_progress.episode_id, [...episodeIds]))!
        : progressTarget
    )
    .returning({ id: playback_progress.id });

  const watchedRows = await tx
    .delete(watched_state)
    .where(
      episodeIds.length > 0
        ? or(watchedTarget, inArray(watched_state.episode_id, [...episodeIds]))!
        : watchedTarget
    )
    .returning({ id: watched_state.id });

  const historyRows = await tx
    .delete(watch_history)
    .where(
      episodeIds.length > 0
        ? or(historyTarget, inArray(watch_history.episode_id, [...episodeIds]))!
        : historyTarget
    )
    .returning({ id: watch_history.id });

  return {
    bookmarks: bookmarkRows.length,
    playbackProgress: progressRows.length,
    watchedState: watchedRows.length,
    watchHistory: historyRows.length,
  };
}

/**
 * Count the user rows that point at content or at a set of episodes.
 *
 * Used by the Trash surface to show the consequences of a permanent deletion
 * before the administrator confirms it.
 */
export async function countPurgeImpact(
  tx: DbOrTx,
  type: ContentReferenceType,
  id: string,
  episodeIds: readonly string[] = []
): Promise<UserContentReferenceCounts> {
  const target = matchesTarget(bookmarks, type, id);
  const progressTarget = matchesTarget(playback_progress, type, id);
  const watchedTarget = matchesTarget(watched_state, type, id);
  const historyTarget = matchesTarget(watch_history, type, id);

  // The queries run one after the other: a transaction uses a single
  // PostgreSQL connection, and the driver does not accept two queries on the
  // same connection at the same time.
  const [bookmarkRow] = await tx.select({ total: count() }).from(bookmarks).where(target);
  const [progressRow] = await tx
    .select({ total: count() })
    .from(playback_progress)
    .where(
      episodeIds.length > 0
        ? or(progressTarget, inArray(playback_progress.episode_id, [...episodeIds]))!
        : progressTarget
    );
  const [watchedRow] = await tx
    .select({ total: count() })
    .from(watched_state)
    .where(
      episodeIds.length > 0
        ? or(watchedTarget, inArray(watched_state.episode_id, [...episodeIds]))!
        : watchedTarget
    );
  const [historyRow] = await tx
    .select({ total: count() })
    .from(watch_history)
    .where(
      episodeIds.length > 0
        ? or(historyTarget, inArray(watch_history.episode_id, [...episodeIds]))!
        : historyTarget
    );

  return {
    bookmarks: Number(bookmarkRow?.total ?? 0),
    playbackProgress: Number(progressRow?.total ?? 0),
    watchedState: Number(watchedRow?.total ?? 0),
    watchHistory: Number(historyRow?.total ?? 0),
  };
}

/**
 * Remove the user rows that point at a set of episodes.
 *
 * A season or an episode has no user rows of its own: the personal records
 * belong to the episodes. These rows are removed with the episodes.
 */
export async function purgeEpisodeReferences(
  tx: Tx,
  episodeIds: readonly string[]
): Promise<UserContentReferenceCounts> {
  if (episodeIds.length === 0) {
    return { bookmarks: 0, playbackProgress: 0, watchedState: 0, watchHistory: 0 };
  }

  const ids = [...episodeIds];

  const progressRows = await tx
    .delete(playback_progress)
    .where(inArray(playback_progress.episode_id, ids))
    .returning({ id: playback_progress.id });

  const watchedRows = await tx
    .delete(watched_state)
    .where(inArray(watched_state.episode_id, ids))
    .returning({ id: watched_state.id });

  const historyRows = await tx
    .delete(watch_history)
    .where(inArray(watch_history.episode_id, ids))
    .returning({ id: watch_history.id });

  return {
    bookmarks: 0,
    playbackProgress: progressRows.length,
    watchedState: watchedRows.length,
    watchHistory: historyRows.length,
  };
}

/** Count the user rows that point at a set of episodes. */
export async function countEpisodeImpact(
  tx: DbOrTx,
  episodeIds: readonly string[]
): Promise<UserContentReferenceCounts> {
  if (episodeIds.length === 0) {
    return { bookmarks: 0, playbackProgress: 0, watchedState: 0, watchHistory: 0 };
  }

  const ids = [...episodeIds];

  // The queries run one after the other: a transaction uses a single
  // PostgreSQL connection, and the driver does not accept two queries on the
  // same connection at the same time.
  const [progressRow] = await tx
    .select({ total: count() })
    .from(playback_progress)
    .where(inArray(playback_progress.episode_id, ids));
  const [watchedRow] = await tx
    .select({ total: count() })
    .from(watched_state)
    .where(inArray(watched_state.episode_id, ids));
  const [historyRow] = await tx
    .select({ total: count() })
    .from(watch_history)
    .where(inArray(watch_history.episode_id, ids));

  return {
    bookmarks: 0,
    playbackProgress: Number(progressRow?.total ?? 0),
    watchedState: Number(watchedRow?.total ?? 0),
    watchHistory: Number(historyRow?.total ?? 0),
  };
}
