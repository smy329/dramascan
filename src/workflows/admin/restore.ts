import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import { parseOrThrow } from '@/modules/content/validation';

import {
  dramas,
  seasons,
  episodes,
  movies,
} from '@/modules/content/schema';

/** Restore a trashed drama, recovering its hierarchy (seasons, episodes).
 *  Authorized non-Super Admin roles that have drama.manage may restore.
 */
export async function restoreDrama(
  actor: ActorContext,
  dramaId: string
): Promise<{ ok: true; drama: ReturnType<typeof toDrama> } | { ok: false; error: unknown }> {
  requirePermission(actor, 'drama.manage');

  const parsedId = parseOrThrow(z.uuid(), dramaId);

  // Re-activate the drama row by clearing deleted_at.
  const [row] = await db
    .update(dramas)
    .set({ deleted_at: null })
    .where(eq(dramas.id, parsedId))
    .returning();

  if (!row) {
    return { ok: false as const, error: new NotFoundError('Drama not found.') };
  }

  return {
    ok: true as const,
    drama: toDrama(row),
  };
}

/** Restore a trashed season, recovering its episode hierarchy. */
export async function restoreSeason(
  actor: ActorContext,
  seasonId: string
): Promise<{ ok: true; season: ReturnType<typeof toSeason> } | { ok: false; error: unknown }> {
  requirePermission(actor, 'season.manage');

  const parsedId = parseOrThrow(z.uuid(), seasonId);

  // Re-activate the season row by clearing deleted_at.
  const [row] = await db
    .update(seasons)
    .set({ deleted_at: null })
    .where(eq(seasons.id, parsedId))
    .returning();

  if (!row) {
    return { ok: false as const, error: new NotFoundError('Season not found.') };
  }

  return {
    ok: true as const,
    season: toSeason(row),
  };
}

/** Restore a trashed episode. */
export async function restoreEpisode(
  actor: ActorContext,
  episodeId: string
): Promise<{ ok: true; episode: ReturnType<typeof toEpisode> } | { ok: false; error: unknown }> {
  requirePermission(actor, 'episode.manage');

  const parsedId = parseOrThrow(z.uuid(), episodeId);

  // Re-activate the episode row by clearing deleted_at.
  const [row] = await db
    .update(episodes)
    .set({ deleted_at: null })
    .where(eq(episodes.id, parsedId))
    .returning();

  if (!row) {
    return { ok: false as const, error: new NotFoundError('Episode not found.') };
  }

  return {
    ok: true as const,
    episode: toEpisode(row),
  };
}

/** Restore a trashed movie. */
export async function restoreMovie(
  actor: ActorContext,
  movieId: string
): Promise<{ ok: true; movie: ReturnType<typeof toMovie> } | { ok: false; error: unknown }> {
  requirePermission(actor, 'movie.manage');

  const parsedId = parseOrThrow(z.uuid(), movieId);

  // Re-activate the movie row by clearing deleted_at.
  const [row] = await db
    .update(movies)
    .set({ deleted_at: null })
    .where(eq(movies.id, parsedId))
    .returning();

  if (!row) {
    return { ok: false as const, error: new NotFoundError('Movie not found.') };
  }

  return {
    ok: true as const,
    movie: toMovie(row),
  };
}

function toDrama(row: typeof dramas.$inferSelect) {
  const publicationStatus = row.publication_status;

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    status: row.status,
    structure_type: row.structure_type,
    visibility: row.visibility,
    poster: row.poster,
    banner: row.banner,
    publicationStatus,
    publiclyAvailable: publicationStatus === 'published' && row.deleted_at === null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSeason(row: typeof seasons.$inferSelect) {
  return {
    id: row.id,
    dramaId: row.drama_id,
    title: row.title,
    position: row.position ?? 0,
    publicationStatus: row.publication_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toEpisode(row: typeof episodes.$inferSelect) {
  return {
    id: row.id,
    dramaId: row.drama_id,
    seasonId: row.season_id,
    title: row.title,
    description: row.description,
    episodeNumber: row.episode_number,
    position: row.position,
    publicationStatus: row.publication_status,
    videoSource: row.video_source,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toMovie(row: typeof movies.$inferSelect) {
  const publicationStatus = row.publication_status;

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    poster: row.poster,
    banner: row.banner,
    publicationStatus,
    publiclyAvailable: publicationStatus === 'published' && row.deleted_at === null,
    videoSource: row.video_source,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

