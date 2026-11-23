import 'server-only';

import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { ratings } from './schema';

/**
 * Public rating read model.
 *
 * A rating is one score on the five-point scale. The details page shows the
 * average and how many people rated the item; it never invents either value.
 *
 * An anonymized rating still counts: the score survives the permanent deletion
 * of its author, which is the point of anonymization. A soft-deleted rating
 * does not count.
 */

/** The aggregate a details page displays. */
export type RatingSummary = {
  /** Mean score, to one decimal place when rendered. */
  average: number;
  /** How many ratings the average is based on. */
  count: number;
};

/**
 * Read the rating summary of a drama or a movie.
 *
 * Returns `null` when nobody has rated the item, so the caller can render
 * "No ratings yet" instead of a fabricated `0.0`.
 */
export async function getRatingSummary(
  type: 'drama' | 'movie',
  id: string,
  executor: DbExecutor = db
): Promise<RatingSummary | null> {
  const [row] = await executor
    .select({
      average: sql<string>`avg(${ratings.value})`,
      count: count(),
    })
    .from(ratings)
    .where(
      and(
        isNull(ratings.deleted_at),
        type === 'drama' ? eq(ratings.drama_id, id) : eq(ratings.movie_id, id)
      )
    );

  const total = Number(row?.count ?? 0);

  if (total === 0) {
    return null;
  }

  return {
    average: Number(row?.average ?? 0),
    count: total,
  };
}
