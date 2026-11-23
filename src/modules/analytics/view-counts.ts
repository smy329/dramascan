import 'server-only';

import { and, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { matchesTarget } from './content-ownership';
import { analytics_daily_aggregates } from './schema';

/**
 * Public view-count read model.
 *
 * A view is counted once per visitor per content item in a rolling window
 * (D-002). The daily aggregate table is the derived source of truth for the
 * public count: it is already deduplicated, so a details page can display a
 * number without walking every raw event.
 *
 * This is a read only. Counting belongs to the view-counting workflow, not to
 * the page that renders the result.
 */

/**
 * Total views recorded for a drama or a movie.
 *
 * Returns `0` when the item has no aggregate yet — a real zero, not a made-up
 * number. The page decides how to present it.
 */
export async function getContentViewCount(
  type: 'drama' | 'movie',
  id: string,
  executor: DbExecutor = db
): Promise<number> {
  const [row] = await executor
    .select({
      total: sql<string>`coalesce(sum(${analytics_daily_aggregates.total_views}), 0)`,
    })
    .from(analytics_daily_aggregates)
    .where(
      and(
        matchesTarget(analytics_daily_aggregates, type, id),
        isNull(analytics_daily_aggregates.deleted_at)
      )
    );

  return Number(row?.total ?? 0);
}
