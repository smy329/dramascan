import 'server-only';

import { and, count, eq } from 'drizzle-orm';

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

/** Count analytics rows that point at a drama. */
export async function countContentReferences(
  tx: DbOrTx,
  dramaId: string
): Promise<AnalyticsContentReferenceCounts> {
  const [[viewRow], [playbackRow], [aggregateRow]] = await Promise.all([
    tx
      .select({ total: count() })
      .from(content_view_events)
      .where(
        and(
          eq(content_view_events.content_type, 'drama'),
          eq(content_view_events.content_id, dramaId)
        )
      ),
    tx
      .select({ total: count() })
      .from(playback_analytics_events)
      .where(
        and(
          eq(playback_analytics_events.content_type, 'drama'),
          eq(playback_analytics_events.content_id, dramaId)
        )
      ),
    tx
      .select({ total: count() })
      .from(analytics_daily_aggregates)
      .where(
        and(
          eq(analytics_daily_aggregates.content_type, 'drama'),
          eq(analytics_daily_aggregates.content_id, dramaId)
        )
      ),
  ]);

  return {
    contentViewEvents: Number(viewRow?.total ?? 0),
    playbackEvents: Number(playbackRow?.total ?? 0),
    dailyAggregates: Number(aggregateRow?.total ?? 0),
  };
}

/** Move analytics references from the drama to the movie. */
export async function moveContentReferences(
  tx: Tx,
  dramaId: string,
  movieId: string
): Promise<void> {
  await tx
    .update(content_view_events)
    .set({ content_type: 'movie', content_id: movieId })
    .where(
      and(
        eq(content_view_events.content_type, 'drama'),
        eq(content_view_events.content_id, dramaId)
      )
    );

  await tx
    .update(playback_analytics_events)
    .set({ content_type: 'movie', content_id: movieId })
    .where(
      and(
        eq(playback_analytics_events.content_type, 'drama'),
        eq(playback_analytics_events.content_id, dramaId)
      )
    );

  await tx
    .update(analytics_daily_aggregates)
    .set({ content_type: 'movie', content_id: movieId })
    .where(
      and(
        eq(analytics_daily_aggregates.content_type, 'drama'),
        eq(analytics_daily_aggregates.content_id, dramaId)
      )
    );
}
