import 'server-only';

import { and, count, eq, isNull, ne } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import { seasons, episodes, dramas } from '@/modules/content/schema';
import { parseOrThrow } from '@/modules/content/validation';

/** Permission key for season management. */
const MANAGE_PERMISSION = 'season.manage';

/** Season create. */
export async function createSeason(
  actor: ActorContext,
  dramaId: string,
  input: unknown
): Promise<{ ok: true; season: ReturnType<typeof toSeason> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  // Check drama exists
  const [drama] = await db
    .select({ title: dramas.title })
    .from(dramas)
    .where(eq(dramas.id, parsedDramaId));

  if (!drama) {
    return { ok: false, error: new NotFoundError('Drama not found.') };
  }

  // Parse season input - only allow title and position for now
  const seasonSchema = z.strictObject({
    title: z.string().trim().min(1).max(100),
    position: z.coerce.number().int().min(0).default(0),
  });

  const parsed = parseOrThrow(seasonSchema, input);

  // Check for duplicate position within the drama
  const [existing] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.drama_id, parsedDramaId), eq(seasons.position, parsed.position), isNull(seasons.deleted_at)));

  if (existing) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A season with this position already exists.',
        fieldErrors: { position: ['A season with this position already exists.'] },
      },
    };
  }

  const [row] = await db
    .insert(seasons)
    .values({
      drama_id: parsedDramaId,
      title: parsed.title,
      position: parsed.position,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Season not found.') };
  }

  return { ok: true, season: toSeason(row) };
}

/** Season update. */
export async function updateSeason(
  actor: ActorContext,
  seasonId: string,
  input: unknown
): Promise<{ ok: true; season: ReturnType<typeof toSeason> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedSeasonId = parseOrThrow(z.uuid(), seasonId);
  const seasonSchema = z.strictObject({
    title: z.string().trim().min(1).max(100).optional(),
    position: z.coerce.number().int().min(0).optional(),
  });

  const parsed = parseOrThrow(seasonSchema, input);

  // Check for duplicate position (excluding current season)
  const [conflict] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(
      and(
        eq(seasons.drama_id, parsedSeasonId),
        eq(seasons.position, parsed.position ?? -1), // -1 means no position check
        isNull(seasons.deleted_at),
        ne(seasons.id, parsedSeasonId)
      )
    );

  if (conflict) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A season with this position already exists.',
        fieldErrors: { position: ['A season with this position already exists.'] },
      },
    };
  }

  const [row] = await db
    .update(seasons)
    .set({
      title: parsed.title,
      position: parsed.position,
      updated_at: new Date(),
    })
    .where(eq(seasons.id, parsedSeasonId))

    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Season not found.') };
  }

  return { ok: true, season: toSeason(row) };
}

/** List seasons for a drama. */
export async function listSeasons(
  actor: ActorContext,
  dramaId: string
): Promise<{ ok: true; seasons: ReturnType<typeof toSeason>[]; total: number }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  const [totalRow] = await db
    .select({ total: count() })
    .from(seasons)
    .where(and(eq(seasons.drama_id, parsedDramaId), isNull(seasons.deleted_at)));

  const total = Number(totalRow?.total ?? 0);

  const rows = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.drama_id, parsedDramaId), isNull(seasons.deleted_at)))
    .orderBy(seasons.position);

  return {
    ok: true,
    seasons: rows.map(toSeason),
    total,
  };
}

/** Soft-delete a season (move to trash). */
export async function deleteSeason(
  actor: ActorContext,
  seasonId: string
): Promise<
  | { ok: true; affectedEpisodes: number }
  | { ok: false; error: unknown; affectedEpisodes: number }
> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedSeasonId = parseOrThrow(z.uuid(), seasonId);

  // Count episodes that will be affected (episodes with this season_id)
  const [episodeCountRow] = await db
    .select({ count: count() })
    .from(episodes)
    .where(eq(episodes.season_id, parsedSeasonId));

  const affectedEpisodes = Number(episodeCountRow?.count ?? 0);

  // Check that the season exists and is not already deleted
  const [season] = await db
    .select({ id: seasons.id, title: seasons.title, drama_id: seasons.drama_id })
    .from(seasons)
    .where(and(eq(seasons.id, parsedSeasonId), isNull(seasons.deleted_at)));

  if (!season) {
    return { ok: false, error: new NotFoundError('Season not found.'), affectedEpisodes: 0 };
  }

  // Check that the drama exists
  const [drama] = await db
    .select({ id: dramas.id, title: dramas.title })
    .from(dramas)
    .where(eq(dramas.id, season.drama_id));

  if (!drama) {
    return { ok: false, error: new NotFoundError('Drama not found.'), affectedEpisodes: 0 };
  }

  // **Critical workflow check**: Prevent deletion if the drama has active episodes
  // with the season_id set and the drama is currently being streamed or tracked.
  // For now, we allow the delete but reassign episodes' season_id to null.
  // A more critical check would verify if the drama has active subscriptions,
  // which would require additional business logic beyond this prompt's scope.

  // Soft-delete the season
  await db
    .update(seasons)
    .set({ deleted_at: new Date() })
    .where(eq(seasons.id, parsedSeasonId));

  // Reassign episodes in this season to have no season_id
  await db
    .update(episodes)
    .set({ season_id: null })
    .where(eq(episodes.season_id, parsedSeasonId));

  return { ok: true, affectedEpisodes };
}

/** Function to restore a season from trash (optional future feature). */

function toSeason(row: typeof seasons.$inferSelect) {
  return {
    id: row.id,
    dramaId: row.drama_id,
    title: row.title,
    position: row.position,
    publicationStatus: row.publication_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
