import 'server-only';

import { and, count, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { db } from '@/db/client';

import {
  analytics_daily_aggregates,
  content_view_events,
  playback_analytics_events,
} from './schema';

/**
 * Analytics rows are attributed to the content item that produced them. When a
 * drama becomes a movie, the rows follow the new identity so view counts and
 * aggregates remain attached to the same content. This is a reassignment, not
 * a rewrite of the recorded event values.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = Tx | typeof db;

export type AnalyticsContentReferenceCounts = {
  contentViewEvents: number;
  playbackEvents: number;
  dailyAggregates: number;
};

/** The columns that identify the target of an analytics row. */
type TargetColumns = {
  drama_id: AnyPgColumn;
  movie_id: AnyPgColumn;
  content_type: AnyPgColumn;
  content_id: AnyPgColumn;
};

/**
 * Match the rows that point at one content item.
 *
 * The typed target is authoritative; a row without any typed target falls back
 * to the legacy pair. The two cases are mutually exclusive, so a row is never
 * counted twice and never moved twice.
 */
function matchesTarget(columns: TargetColumns, type: 'drama' | 'movie', id: string): SQL {
  const typed = type === 'drama' ? eq(columns.drama_id, id) : eq(columns.movie_id, id);
  const legacy = and(
    isNull(columns.drama_id),
    isNull(columns.movie_id),
    eq(columns.content_type, type),
    eq(columns.content_id, id)
  );

  return or(typed, legacy) as SQL;
}

/** The values that make a row point at a content item. */
function targetValues(id: string) {
  return {
    drama_id: null,
    movie_id: id,
    content_type: 'movie',
    content_id: id,
  };
}

/** Count analytics rows that point at a drama. */
export async function countContentReferences(
  tx: DbOrTx,
  dramaId: string
): Promise<AnalyticsContentReferenceCounts> {
  // The queries run one after the other: a transaction uses a single
  // PostgreSQL connection, and the driver does not accept two queries on the
  // same connection at the same time.
  const [viewRow] = await tx
    .select({ total: count() })
    .from(content_view_events)
    .where(matchesTarget(content_view_events, 'drama', dramaId));
  const [playbackRow] = await tx
    .select({ total: count() })
    .from(playback_analytics_events)
    .where(matchesTarget(playback_analytics_events, 'drama', dramaId));
  const [aggregateRow] = await tx
    .select({ total: count() })
    .from(analytics_daily_aggregates)
    .where(matchesTarget(analytics_daily_aggregates, 'drama', dramaId));

  return {
    contentViewEvents: Number(viewRow?.total ?? 0),
    playbackEvents: Number(playbackRow?.total ?? 0),
    dailyAggregates: Number(aggregateRow?.total ?? 0),
  };
}

type AggregateRow = {
  id: string;
  date: string;
  drama_id: string | null;
  movie_id: string | null;
  unique_visitors: number | null;
  total_views: number | null;
  total_playback_events: number | null;
  completion_events: number | null;
  total_watch_duration_seconds: number | null;
};

/**
 * Move analytics references from the drama to the movie.
 *
 * The event tables are append-only facts: every row is reassigned, none is
 * merged. The daily aggregate is derived data, so the rows of one date are
 * merged into a single movie row: the counters add up, and the visitor count
 * takes the larger of the two because the overlap between them is unknown.
 */
export async function moveContentReferences(
  tx: Tx,
  dramaId: string,
  movieId: string
): Promise<void> {
  await tx
    .update(content_view_events)
    .set(targetValues(movieId))
    .where(matchesTarget(content_view_events, 'drama', dramaId));

  await tx
    .update(playback_analytics_events)
    .set(targetValues(movieId))
    .where(matchesTarget(playback_analytics_events, 'drama', dramaId));

  await moveDailyAggregates(tx, dramaId, movieId);
}

/**
 * Move the daily aggregates, merging the rows of one date.
 */
async function moveDailyAggregates(tx: Tx, dramaId: string, movieId: string): Promise<void> {
  const columns = {
    id: analytics_daily_aggregates.id,
    date: analytics_daily_aggregates.date,
    drama_id: analytics_daily_aggregates.drama_id,
    movie_id: analytics_daily_aggregates.movie_id,
    unique_visitors: analytics_daily_aggregates.unique_visitors,
    total_views: analytics_daily_aggregates.total_views,
    total_playback_events: analytics_daily_aggregates.total_playback_events,
    completion_events: analytics_daily_aggregates.completion_events,
    total_watch_duration_seconds: analytics_daily_aggregates.total_watch_duration_seconds,
  };

  const sourceRows = await tx
    .select(columns)
    .from(analytics_daily_aggregates)
    .where(matchesTarget(analytics_daily_aggregates, 'drama', dramaId));

  if (sourceRows.length === 0) {
    return;
  }

  const targetRows = await tx
    .select(columns)
    .from(analytics_daily_aggregates)
    .where(matchesTarget(analytics_daily_aggregates, 'movie', movieId));

  const targetByDate = groupByDate(targetRows);
  const doomed = new Set<string>();
  const updates: { id: string; values: Record<string, unknown> }[] = [];

  for (const [date, sourceRowsOfDate] of groupByDate(sourceRows)) {
    // Every row of the date is merged, not only the first target row: two
    // target rows for one date are two halves of the same aggregate, and
    // leaving one behind would split the counters of that day.
    const targetRowsOfDate = targetByDate.get(date) ?? [];
    const merged = [...sourceRowsOfDate, ...targetRowsOfDate];
    const survivor = survivorOf(merged);

    for (const row of merged) {
      if (row.id !== survivor.id) {
        doomed.add(row.id);
      }
    }

    updates.push({
      id: survivor.id,
      values: {
        ...targetValues(movieId),
        unique_visitors: maxOf(merged.map(row => row.unique_visitors)),
        total_views: sumOf(merged.map(row => row.total_views)),
        total_playback_events: sumOf(merged.map(row => row.total_playback_events)),
        completion_events: sumOf(merged.map(row => row.completion_events)),
        total_watch_duration_seconds: sumOf(merged.map(row => row.total_watch_duration_seconds)),
        updated_at: new Date(),
      },
    });
  }

  if (doomed.size > 0) {
    await tx
      .delete(analytics_daily_aggregates)
      .where(inArray(analytics_daily_aggregates.id, [...doomed]));
  }

  for (const update of updates) {
    await tx
      .update(analytics_daily_aggregates)
      .set(update.values)
      .where(eq(analytics_daily_aggregates.id, update.id));
  }
}

/** Group aggregate rows by their date. */
function groupByDate(rows: readonly AggregateRow[]): Map<string, AggregateRow[]> {
  const grouped = new Map<string, AggregateRow[]>();

  for (const row of rows) {
    const group = grouped.get(row.date) ?? [];
    group.push(row);
    grouped.set(row.date, group);
  }

  return grouped;
}

/**
 * Choose the row that survives the merge.
 *
 * A target row is preferred, so the merged aggregate keeps the identity of the
 * row that already belonged to the movie. The lowest id breaks a tie, so the
 * result does not depend on the order the rows were read in.
 */
function survivorOf(rows: readonly AggregateRow[]): AggregateRow {
  const targetRows = rows.filter(row => row.movie_id !== null && row.drama_id === null);
  const candidates = targetRows.length > 0 ? targetRows : [...rows];

  return [...candidates].sort((left, right) => left.id.localeCompare(right.id))[0]!;
}

/** Add the values of a counter column. */
function sumOf(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/** Take the largest of a counter column. */
function maxOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);

  return present.length > 0 ? Math.max(...present) : null;
}

/**
 * Remove every analytics row that points at content that is being permanently
 * deleted.
 *
 * Analytics rows describe events on a specific content item. Once the item is
 * gone the events no longer describe anything, so they are removed instead of
 * being kept as references to a row that no longer exists. Site-wide
 * aggregates, which name no content item, are never touched.
 */
export async function purgeContentReferences(
  tx: Tx,
  type: 'drama' | 'movie',
  id: string
): Promise<AnalyticsContentReferenceCounts> {
  const viewRows = await tx
    .delete(content_view_events)
    .where(matchesTarget(content_view_events, type, id))
    .returning({ id: content_view_events.id });

  const playbackRows = await tx
    .delete(playback_analytics_events)
    .where(matchesTarget(playback_analytics_events, type, id))
    .returning({ id: playback_analytics_events.id });

  const aggregateRows = await tx
    .delete(analytics_daily_aggregates)
    .where(matchesTarget(analytics_daily_aggregates, type, id))
    .returning({ id: analytics_daily_aggregates.id });

  return {
    contentViewEvents: viewRows.length,
    playbackEvents: playbackRows.length,
    dailyAggregates: aggregateRows.length,
  };
}

/**
 * Count the analytics rows that point at one content item.
 *
 * Used by the Trash surface to show the consequences of a permanent deletion
 * before the administrator confirms it.
 */
export async function countPurgeImpact(
  tx: DbOrTx,
  type: 'drama' | 'movie',
  id: string
): Promise<AnalyticsContentReferenceCounts> {
  // The queries run one after the other: a transaction uses a single
  // PostgreSQL connection, and the driver does not accept two queries on the
  // same connection at the same time.
  const [viewRow] = await tx
    .select({ total: count() })
    .from(content_view_events)
    .where(matchesTarget(content_view_events, type, id));
  const [playbackRow] = await tx
    .select({ total: count() })
    .from(playback_analytics_events)
    .where(matchesTarget(playback_analytics_events, type, id));
  const [aggregateRow] = await tx
    .select({ total: count() })
    .from(analytics_daily_aggregates)
    .where(matchesTarget(analytics_daily_aggregates, type, id));

  return {
    contentViewEvents: Number(viewRow?.total ?? 0),
    playbackEvents: Number(playbackRow?.total ?? 0),
    dailyAggregates: Number(aggregateRow?.total ?? 0),
  };
}
