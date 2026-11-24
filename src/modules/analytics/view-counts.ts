import 'server-only';

import { and, count, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { content_view_events } from './schema';

/**
 * The public view-count read model.
 *
 * A view is counted once per visitor per content item in a rolling six-hour
 * window (D-002). The count the public pages show is the number of counted
 * view events for the content item: it is the exact number, and it is
 * available immediately, without waiting for an aggregation cycle.
 *
 * The daily aggregate table is the *dashboard's* read model. It answers "how
 * many views happened on this day", which is a different question from "how
 * many views has this title had".
 *
 * This is a read only. Counting belongs to the view-counting workflow, not to
 * the page that renders the result.
 */

/**
 * Total views recorded for a drama or a movie.
 *
 * Returns `0` when the item has never been viewed — a real zero, not a
 * made-up number. The page decides how to present it.
 */
export async function getContentViewCount(
  type: 'drama' | 'movie',
  id: string,
  executor: DbExecutor = db
): Promise<number> {
  const [row] = await executor
    .select({ total: count() })
    .from(content_view_events)
    .where(
      and(
        eq(content_view_events.content_type, type),
        type === 'drama'
          ? eq(content_view_events.drama_id, id)
          : eq(content_view_events.movie_id, id),
        isNull(content_view_events.deleted_at)
      )
    );

  return Number(row?.total ?? 0);
}
