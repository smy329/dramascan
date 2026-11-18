import 'server-only';

import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { evaluatePublicAvailability } from '@/modules/content/publication';

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

  // Parse season input - allow optional position
  const seasonSchema = z.strictObject({
    title: z.string().trim().min(1).max(100),
    position: z.coerce.number().int().min(0).optional(),
  });

  const parsed = parseOrThrow(seasonSchema, input);

  return db.transaction(async tx => {
    // Lock the parent drama for the whole allocation. The lock proves the drama
    // exists and serializes position allocation for its seasons, so two
    // concurrent creates cannot both see the same free position.
    const [drama] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, parsedDramaId))
      .for('no key update')
      .limit(1);

    if (!drama) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    let targetPosition = parsed.position;

    if (targetPosition === undefined) {
      const [posRow] = await tx
        .select({ maxPos: sql<number | null>`max(${seasons.position})` })
        .from(seasons)
        .where(and(eq(seasons.drama_id, parsedDramaId), isNull(seasons.deleted_at)));

      targetPosition = posRow?.maxPos === null || posRow?.maxPos === undefined ? 0 : Number(posRow.maxPos) + 1;
    } else {
      // Check for duplicate explicit position within the drama
      const [existing] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(
          and(
            eq(seasons.drama_id, parsedDramaId),
            eq(seasons.position, targetPosition),
            isNull(seasons.deleted_at)
          )
        );

      if (existing) {
        return {
          ok: false as const,
          error: {
            code: 'validation_error',
            message: 'A season with this position already exists.',
            fieldErrors: { position: ['A season with this position already exists.'] },
          },
        };
      }
    }

    const [row] = await tx
      .insert(seasons)
      .values({
        drama_id: parsedDramaId,
        title: parsed.title,
        position: targetPosition,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    if (!row) {
      return { ok: false as const, error: new NotFoundError('Season not found.') };
    }

    return { ok: true as const, season: toSeason(row) };
  });
}

/**
 * Season update.
 *
 * The position conflict is scoped to the season's real parent drama, loaded
 * from the row rather than inferred from the season id, and excludes the season
 * itself. Comparing `seasons.drama_id` to the season id never matched, so the
 * duplicate-position check silently passed for every update (M-02).
 */
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

  return db.transaction(async tx => {
    // The season's drama is read first without a lock, so the parent can be
    // locked before the season. Every writer that allocates a position in this
    // drama takes the same drama lock, so two concurrent updates cannot read
    // the same free position at the same time.
    const [seasonRef] = await tx
      .select({ id: seasons.id, drama_id: seasons.drama_id })
      .from(seasons)
      .where(eq(seasons.id, parsedSeasonId))
      .limit(1);

    if (!seasonRef) {
      return { ok: false as const, error: new NotFoundError('Season not found.') };
    }

    const [drama] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, seasonRef.drama_id))
      .for('no key update')
      .limit(1);

    if (!drama) {
      return { ok: false as const, error: new NotFoundError('Season not found.') };
    }

    // Re-read the season under its own lock, now that the drama is locked.
    const [season] = await tx
      .select({ id: seasons.id, drama_id: seasons.drama_id })
      .from(seasons)
      .where(eq(seasons.id, parsedSeasonId))
      .for('no key update')
      .limit(1);

    if (!season) {
      return { ok: false as const, error: new NotFoundError('Season not found.') };
    }

    if (parsed.position !== undefined) {
      const [conflict] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(
          and(
            eq(seasons.drama_id, season.drama_id),
            eq(seasons.position, parsed.position),
            isNull(seasons.deleted_at),
            ne(seasons.id, parsedSeasonId)
          )
        );

      if (conflict) {
        return {
          ok: false as const,
          error: {
            code: 'validation_error',
            message: 'A season with this position already exists.',
            fieldErrors: { position: ['A season with this position already exists.'] },
          },
        };
      }
    }

    const [row] = await tx
      .update(seasons)
      .set({
        title: parsed.title,
        position: parsed.position,
        updated_at: new Date(),
      })
      .where(eq(seasons.id, parsedSeasonId))
      .returning();

    if (!row) {
      return { ok: false as const, error: new NotFoundError('Season not found.') };
    }

    return { ok: true as const, season: toSeason(row) };
  });
}

/** List seasons for a drama. */
export async function listSeasons(
  actor: ActorContext,
  dramaId: string
): Promise<{ ok: true; seasons: (ReturnType<typeof toSeason> & { episodeCount: number; publiclyAvailable: boolean })[]; total: number }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  const [totalRow] = await db
    .select({ total: count() })
    .from(seasons)
    .where(and(eq(seasons.drama_id, parsedDramaId), isNull(seasons.deleted_at)));

  const total = Number(totalRow?.total ?? 0);

  const episodesCount = db
    .select({
      season_id: episodes.season_id,
      total: count().as('episode_total'),
    })
    .from(episodes)
    .where(isNull(episodes.deleted_at))
    .groupBy(episodes.season_id)
    .as('episodesCount');

  const rows = await db
    .select({
      season: seasons,
      drama: dramas,
      episodeCount: sql<number>`coalesce(${episodesCount.total}, 0)`,
    })
    .from(seasons)
    .innerJoin(dramas, eq(seasons.drama_id, dramas.id))
    .leftJoin(
      episodesCount,
      eq(episodesCount.season_id, seasons.id)
    )
    .where(and(eq(seasons.drama_id, parsedDramaId), isNull(seasons.deleted_at)))
    .orderBy(seasons.position);

  return {
    ok: true,
    seasons: rows.map(row => ({
      ...toSeason(row.season),
      episodeCount: Number(row.episodeCount ?? 0),
      publiclyAvailable: evaluatePublicAvailability({
        contentType: 'season',
        publicationStatus: (row.season.publication_status ?? 'draft') as
          'draft' | 'published' | 'unpublished',
        deleted: row.season.deleted_at !== null,
        parentDrama: {
          publicationStatus: (row.drama.publication_status ?? 'draft') as
            'draft' | 'published' | 'unpublished',
          deleted: row.drama.deleted_at !== null,
        },
      }).publiclyAvailable,
    })),
    total,
  };
}

/**
 * Move a season and its active episode hierarchy to Trash.
 *
 * The whole operation is one transaction. The season row is locked first, so a
 * second concurrent delete waits and then sees an already-trashed season
 * instead of double-counting episodes.
 *
 * `season_id` is deliberately preserved on the trashed episodes. The seasons'
 * Trash is a restorable state, so the hierarchy must survive; detaching the
 * episodes (the previous behaviour) destroyed the relationship that a restore
 * needs and left the episodes looking unseasoned.
 */
export async function deleteSeason(
  actor: ActorContext,
  seasonId: string
): Promise<
  { ok: true; affectedEpisodes: number } | { ok: false; error: unknown; affectedEpisodes: number }
> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedSeasonId = parseOrThrow(z.uuid(), seasonId);

  return db.transaction(async tx => {
    const [season] = await tx
      .select({ id: seasons.id })
      .from(seasons)
      .where(and(eq(seasons.id, parsedSeasonId), isNull(seasons.deleted_at)))
      .for('no key update')
      .limit(1);

    if (!season) {
      return {
        ok: false as const,
        error: new NotFoundError('Season not found.'),
        affectedEpisodes: 0,
      };
    }

    const now = new Date();

    // Trash and count in one statement: the reported count is exactly the set
    // that changed, and episodes that were already in the trash keep their
    // original deletion time.
    const trashedEpisodes = await tx
      .update(episodes)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(episodes.season_id, parsedSeasonId), isNull(episodes.deleted_at)))
      .returning({ id: episodes.id });

    await tx
      .update(seasons)
      .set({ deleted_at: now, updated_at: now })
      .where(eq(seasons.id, parsedSeasonId));

    return { ok: true as const, affectedEpisodes: trashedEpisodes.length };
  });
}

/** Reorder seasons for a drama. */
export async function reorderSeasons(
  actor: ActorContext,
  dramaId: string,
  ids: string[]
): Promise<{ ok: true; reordered: number } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);
  const parsedIds = parseOrThrow(z.array(z.uuid()).min(1), ids);

  if (new Set(parsedIds).size !== parsedIds.length) {
    const message = 'The reorder request contains duplicate ids.';
    return { ok: false, error: { code: 'validation_error', message, fieldErrors: { ids: [message] } } };
  }

  return db.transaction(async tx => {
    // Lock parent drama
    const [drama] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(and(eq(dramas.id, parsedDramaId), isNull(dramas.deleted_at)))
      .for('no key update')
      .limit(1);

    if (!drama) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    const rows = await tx
      .select({ id: seasons.id })
      .from(seasons)
      .where(
        and(
          eq(seasons.drama_id, parsedDramaId),
          inArray(seasons.id, parsedIds),
          isNull(seasons.deleted_at)
        )
      )
      .orderBy(asc(seasons.id))
      .for('update');

    if (rows.length !== parsedIds.length) {
      const message = 'One or more seasons do not exist, belong to another drama, or are in the Trash.';
      return { ok: false as const, error: { code: 'validation_error', message, fieldErrors: { ids: [message] } } };
    }

    // Step 1: Temporarily negate positions to clear unique constraint
    for (const [index, id] of parsedIds.entries()) {
      await tx
        .update(seasons)
        .set({ position: -(index + 1), updated_at: new Date() })
        .where(eq(seasons.id, id));
    }

    // Step 2: Set final positive positions 0..n-1
    for (const [index, id] of parsedIds.entries()) {
      await tx
        .update(seasons)
        .set({ position: index, updated_at: new Date() })
        .where(eq(seasons.id, id));
    }

    return { ok: true as const, reordered: parsedIds.length };
  });
}

/** Function to restore a season from trash (optional future feature). */

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
