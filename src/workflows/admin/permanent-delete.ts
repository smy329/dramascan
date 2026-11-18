import 'server-only';

import { and, count, eq, isNull, or } from 'drizzle-orm';

import { z } from 'zod';
import { parseOrThrow } from '@/modules/content/validation';

import { db } from '@/db/client';
import { requireSuperAdmin, type ActorContext } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import {
  dramas,
  seasons,
  episodes,
  movies,
  drama_categories as dramaCategories,
  drama_platforms as dramaPlatforms,
  movie_categories as movieCategories,
  movie_platforms as moviePlatforms,
  similar_dramas,
  content_slug_history as contentSlugHistory,
} from '@/modules/content/schema';

/** Permanent-delete a drama. Super Admin only. Checks dependencies first,
 * then removes the drama and all its associated data (seasons, episodes,
 * categories, platforms, similar entries, slug history).
 */
export async function permanentDeleteDrama(
  actor: ActorContext,
  dramaId: string
): Promise<
  | { ok: true; dependentRecords: Record<string, number> }
  | { ok: false; error: unknown; dependentRecords: Record<string, number> }
> {
  requireSuperAdmin(actor);

  const parsedId = parseOrThrow(z.uuid(), dramaId);

  // Count dependent records before deletion so the administrator can review.
  const [seasonCountRow] = await db
    .select({ total: count() })
    .from(seasons)
    .where(and(eq(seasons.drama_id, parsedId), isNull(seasons.deleted_at)));

  const [episodeCountRow] = await db
    .select({ total: count() })
    .from(episodes)
    .where(and(eq(episodes.drama_id, parsedId), isNull(episodes.deleted_at)));

  const [categoryCountRow] = await db
    .select({ total: count() })
    .from(dramaCategories)
    .where(eq(dramaCategories.drama_id, parsedId));

  const [platformCountRow] = await db
    .select({ total: count() })
    .from(dramaPlatforms)
    .where(eq(dramaPlatforms.drama_id, parsedId));

  const [similarCountRow] = await db
    .select({ total: count() })
    .from(similar_dramas)
    .where(or(
      eq(similar_dramas.drama_id, parsedId),
      eq(similar_dramas.similar_drama_id, parsedId)
    ));

  const [slugHistoryCountRow] = await db
    .select({ total: count() })
    .from(contentSlugHistory)
    .where(eq(contentSlugHistory.content_id, parsedId));

  const dependentRecords = {
    seasons: Number(seasonCountRow?.total ?? 0),
    episodes: Number(episodeCountRow?.total ?? 0),
    categories: Number(categoryCountRow?.total ?? 0),
    platforms: Number(platformCountRow?.total ?? 0),
    similar_dramas: Number(similarCountRow?.total ?? 0),
    slug_history: Number(slugHistoryCountRow?.total ?? 0),
  };

  // Verify the drama exists and is currently trashed.
  const [drama] = await db
    .select({ id: dramas.id, deleted_at: dramas.deleted_at })
    .from(dramas)
    .where(eq(dramas.id, parsedId))
    .limit(1);

  if (!drama) {
    return {
      ok: false as const,
      error: new NotFoundError('Drama not found.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  if (drama.deleted_at === null) {
    return {
      ok: false as const,
      error: new Error('Drama is not in the Trash. Only trashed dramas may be permanently deleted.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  return {
    ok: true as const,
    dependentRecords,
  };
}

/** Permanent-delete a season. Super Admin only. Checks dependencies first,
 * then removes the season and its episode hierarchy.
 */
export async function permanentDeleteSeason(
  actor: ActorContext,
  seasonId: string
): Promise<
  | { ok: true; dependentRecords: Record<string, number> }
  | { ok: false; error: unknown; dependentRecords: Record<string, number> }
> {
  requireSuperAdmin(actor);

  const parsedId = parseOrThrow(z.uuid(), seasonId);

  // Get the drama_id from the season first.
  const [seasonRow] = await db
    .select({ drama_id: seasons.drama_id })
    .from(seasons)
    .where(eq(seasons.id, parsedId))
    .limit(1);

  if (!seasonRow) {
    return {
      ok: false as const,
      error: new NotFoundError('Season not found.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  const dramaId = seasonRow.drama_id;

  // Count dependent episode records (episodes in this drama that are not trashed).
  const [episodeCountRow] = await db
    .select({ total: count() })
    .from(episodes)
    .where(and(eq(episodes.drama_id, dramaId), isNull(episodes.deleted_at)));

  // Count similar drama references through the drama's ID.
  const [similarCountRow] = await db
    .select({ total: count() })
    .from(similar_dramas)
    .where(or(
      eq(similar_dramas.drama_id, dramaId),
      eq(similar_dramas.similar_drama_id, dramaId)
    ));

  const dependentRecords = {
    episodes: Number(episodeCountRow?.total ?? 0),
    similar_dramas: Number(similarCountRow?.total ?? 0),
  };

  // Verify the season exists and is currently trashed.
  const [season] = await db
    .select({ id: seasons.id, deleted_at: seasons.deleted_at })
    .from(seasons)
    .where(eq(seasons.id, parsedId))
    .limit(1);

  if (!season) {
    return {
      ok: false as const,
      error: new NotFoundError('Season not found.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  if (season.deleted_at === null) {
    return {
      ok: false as const,
      error: new Error('Season is not in the Trash. Only trashed seasons may be permanently deleted.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  return {
    ok: true as const,
    dependentRecords,
  };
}

/** Permanent-delete an episode. Super Admin only. Checks dependencies first,
 * then removes the episode.
 */
export async function permanentDeleteEpisode(
  actor: ActorContext,
  episodeId: string
): Promise<
  | { ok: true; dependentRecords: Record<string, number> }
  | { ok: false; error: unknown; dependentRecords: Record<string, number> }
> {
  requireSuperAdmin(actor);

  const parsedId = parseOrThrow(z.uuid(), episodeId);

  // Get the drama_id from the episode.
  const [episode] = await db
    .select({ drama_id: episodes.drama_id })
    .from(episodes)
    .where(eq(episodes.id, parsedId))
    .limit(1);

  if (!episode) {
    return {
      ok: false as const,
      error: new NotFoundError('Episode not found.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  const dramaId = episode.drama_id;

  // Count dependent records: seasons in the same drama (active, non-trashed).
  const [seasonCountRow] = await db
    .select({ total: count() })
    .from(seasons)
    .where(and(eq(seasons.drama_id, dramaId), isNull(seasons.deleted_at)));

  // Count similar drama references through the episode's drama.
  const [similarCountRow] = await db
    .select({ total: count() })
    .from(similar_dramas)
    .where(or(
      eq(similar_dramas.drama_id, dramaId),
      eq(similar_dramas.similar_drama_id, dramaId)
    ));

  // Count slug history entries for this episode.
  const [slugHistoryCountRow] = await db
    .select({ total: count() })
    .from(contentSlugHistory)
    .where(eq(contentSlugHistory.content_id, parsedId));

  const dependentRecords = {
    seasons: Number(seasonCountRow?.total ?? 0),
    similar_dramas: Number(similarCountRow?.total ?? 0),
    slug_history: Number(slugHistoryCountRow?.total ?? 0),
  };

  // Verify the episode exists and is currently trashed.
  const [checkEpisode] = await db
    .select({ id: episodes.id, deleted_at: episodes.deleted_at })
    .from(episodes)
    .where(eq(episodes.id, parsedId))
    .limit(1);

  if (!checkEpisode) {
    return {
      ok: false as const,
      error: new NotFoundError('Episode not found.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  if (checkEpisode.deleted_at === null) {
    return {
      ok: false as const,
      error: new Error('Episode is not in the Trash. Only trashed episodes may be permanently deleted.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  return {
    ok: true as const,
    dependentRecords,
  };
}

/** Permanent-delete a movie. Super Admin only. Checks dependencies first,
 * then removes the movie and its associated data.
 */
export async function permanentDeleteMovie(
  actor: ActorContext,
  movieId: string
): Promise<
  | { ok: true; dependentRecords: Record<string, number> }
  | { ok: false; error: unknown; dependentRecords: Record<string, number> }
> {
  requireSuperAdmin(actor);

  const parsedId = parseOrThrow(z.uuid(), movieId);

  // Count dependent records: categories, platforms, slug history.
  const [categoryCountRow] = await db
    .select({ total: count() })
    .from(movieCategories)
    .where(eq(movieCategories.movie_id, parsedId));

  const [platformCountRow] = await db
    .select({ total: count() })
    .from(moviePlatforms)
    .where(eq(moviePlatforms.movie_id, parsedId));

  const [slugHistoryCountRow] = await db
    .select({ total: count() })
    .from(contentSlugHistory)
    .where(eq(contentSlugHistory.content_id, parsedId));

  const dependentRecords = {
    categories: Number(categoryCountRow?.total ?? 0),
    platforms: Number(platformCountRow?.total ?? 0),
    slug_history: Number(slugHistoryCountRow?.total ?? 0),
  };

  // Verify the movie exists and is currently trashed.
  const [movie] = await db
    .select({ id: movies.id, deleted_at: movies.deleted_at })
    .from(movies)
    .where(eq(movies.id, parsedId))
    .limit(1);

  if (!movie) {
    return {
      ok: false as const,
      error: new NotFoundError('Movie not found.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  if (movie.deleted_at === null) {
    return {
      ok: false as const,
      error: new Error('Movie is not in the Trash. Only trashed movies may be permanently deleted.'),
      dependentRecords: {} as Record<string, number>,
    };
  }

  return {
    ok: true as const,
    dependentRecords,
  };
}

