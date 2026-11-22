import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { ConflictError, NotFoundError, ValidationError } from '@/platform/errors';

import { z } from 'zod';
import { parseOrThrow } from '@/modules/content/validation';

import { dramas, seasons, episodes, movies } from '@/modules/content/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Trash restoration.
 *
 * Restoration is the inverse of the Trash cascade and is deliberately exact:
 *
 *   - A drama restores the seasons and episodes that were trashed *with it*,
 *     identified by the identical `deleted_at` timestamp. Children that were
 *     already in the Trash keep their own timestamp and stay in the Trash.
 *   - A season restores the episodes that were trashed with it, and only when
 *     its drama is active again.
 *   - An episode restores only when its drama, and its season when it has one,
 *     are active.
 *
 * Restoring never silently breaks a uniqueness rule: a conflicting slug,
 * episode number, or season position is reported instead of being renamed.
 */

export type RestoreResult = {
  contentType: 'drama' | 'season' | 'episode' | 'movie';
  id: string;
  restoredSeasons: number;
  restoredEpisodes: number;
};

/**
 * Preflight the active uniqueness rules for the rows a restore re-activates.
 *
 * A cascade restores a whole hierarchy at once, so a single conflicting child
 * would abort the whole restoration with a raw database error. The conflicts
 * are therefore checked before the first write and reported as a conflict the
 * administrator can act on.
 */
async function assertNoHierarchyConflicts(
  tx: Tx,
  dramaId: string,
  seasonsToRestore: readonly { id: string; position: number | null }[],
  episodesToRestore: readonly { id: string; episodeNumber: number | null }[]
): Promise<void> {
  const restoredPositions = new Set<number>();

  for (const season of seasonsToRestore) {
    if (season.position === null) {
      continue;
    }

    if (restoredPositions.has(season.position)) {
      throw new ConflictError(
        `Two trashed seasons of this drama use position ${season.position}. Change one of them before restoring.`
      );
    }

    restoredPositions.add(season.position);

    const [conflict] = await tx
      .select({ id: seasons.id })
      .from(seasons)
      .where(
        and(
          eq(seasons.drama_id, dramaId),
          eq(seasons.position, season.position),
          isNull(seasons.deleted_at)
        )
      )
      .limit(1);

    if (conflict) {
      throw new ConflictError(
        `Another active season of this drama already uses position ${season.position}. Change it before restoring.`
      );
    }
  }

  const restoredNumbers = new Set<number>();

  for (const episode of episodesToRestore) {
    if (episode.episodeNumber === null) {
      continue;
    }

    if (restoredNumbers.has(episode.episodeNumber)) {
      throw new ConflictError(
        `Two trashed episodes of this drama use episode number ${episode.episodeNumber}. Change one of them before restoring.`
      );
    }

    restoredNumbers.add(episode.episodeNumber);

    const [conflict] = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.drama_id, dramaId),
          eq(episodes.episode_number, episode.episodeNumber),
          isNull(episodes.deleted_at)
        )
      )
      .limit(1);

    if (conflict) {
      throw new ConflictError(
        `Another active episode of this drama already uses episode number ${episode.episodeNumber}. Change it before restoring.`
      );
    }
  }
}

/** Restore a trashed drama, recovering its hierarchy (seasons, episodes).
 *  Authorized non-Super Admin roles that have drama.manage may restore.
 */
export async function restoreDrama(actor: ActorContext, dramaId: string): Promise<RestoreResult> {
  requirePermission(actor, 'drama.manage');

  const parsedId = parseOrThrow(z.uuid(), dramaId);

  return db.transaction(async tx => {
    const [drama] = await tx
      .select({ id: dramas.id, slug: dramas.slug, deletedAt: dramas.deleted_at })
      .from(dramas)
      .where(eq(dramas.id, parsedId))
      .for('no key update')
      .limit(1);

    if (!drama) {
      throw new NotFoundError('Drama not found.');
    }

    if (drama.deletedAt === null) {
      throw new ValidationError('This drama is not in the Trash.');
    }

    const [conflict] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(and(eq(dramas.slug, drama.slug), isNull(dramas.deleted_at)))
      .limit(1);

    if (conflict) {
      throw new ConflictError(
        'Another active drama already uses this slug. Rename it before restoring.'
      );
    }

    const deletedAt = drama.deletedAt;
    const now = new Date();

    // The two reads run one after the other: a transaction uses a single
    // PostgreSQL connection, and the driver does not accept two queries on the
    // same connection at the same time.
    const seasonsToRestore = await tx
      .select({ id: seasons.id, position: seasons.position })
      .from(seasons)
      .where(and(eq(seasons.drama_id, parsedId), eq(seasons.deleted_at, deletedAt)));
    const episodesToRestore = await tx
      .select({ id: episodes.id, episodeNumber: episodes.episode_number })
      .from(episodes)
      .where(and(eq(episodes.drama_id, parsedId), eq(episodes.deleted_at, deletedAt)));

    await assertNoHierarchyConflicts(tx, parsedId, seasonsToRestore, episodesToRestore);

    const restoredSeasons = await tx
      .update(seasons)
      .set({ deleted_at: null, updated_at: now })
      .where(and(eq(seasons.drama_id, parsedId), eq(seasons.deleted_at, deletedAt)))
      .returning({ id: seasons.id });

    const restoredEpisodes = await tx
      .update(episodes)
      .set({ deleted_at: null, updated_at: now })
      .where(and(eq(episodes.drama_id, parsedId), eq(episodes.deleted_at, deletedAt)))
      .returning({ id: episodes.id });

    await tx
      .update(dramas)
      .set({ deleted_at: null, updated_at: now })
      .where(eq(dramas.id, parsedId));

    return {
      contentType: 'drama',
      id: parsedId,
      restoredSeasons: restoredSeasons.length,
      restoredEpisodes: restoredEpisodes.length,
    };
  });
}

/** Restore a trashed season, recovering its episode hierarchy. */
export async function restoreSeason(actor: ActorContext, seasonId: string): Promise<RestoreResult> {
  requirePermission(actor, 'season.manage');

  const parsedId = parseOrThrow(z.uuid(), seasonId);

  return db.transaction(async tx => {
    const [season] = await tx
      .select({
        id: seasons.id,
        dramaId: seasons.drama_id,
        position: seasons.position,
        deletedAt: seasons.deleted_at,
      })
      .from(seasons)
      .where(eq(seasons.id, parsedId))
      .for('no key update')
      .limit(1);

    if (!season) {
      throw new NotFoundError('Season not found.');
    }

    if (season.deletedAt === null) {
      throw new ValidationError('This season is not in the Trash.');
    }

    const [drama] = await tx
      .select({ id: dramas.id, deletedAt: dramas.deleted_at })
      .from(dramas)
      .where(eq(dramas.id, season.dramaId))
      .limit(1);

    if (!drama || drama.deletedAt !== null) {
      throw new ValidationError('Restore the drama before restoring its season.');
    }

    if (season.position !== null) {
      const [conflict] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(
          and(
            eq(seasons.drama_id, season.dramaId),
            eq(seasons.position, season.position),
            isNull(seasons.deleted_at)
          )
        )
        .limit(1);

      if (conflict) {
        throw new ConflictError(
          'Another active season of this drama already uses this position. Change it before restoring.'
        );
      }
    }

    const deletedAt = season.deletedAt;
    const now = new Date();

    const episodesToRestore = await tx
      .select({ id: episodes.id, episodeNumber: episodes.episode_number })
      .from(episodes)
      .where(and(eq(episodes.season_id, parsedId), eq(episodes.deleted_at, deletedAt)));

    await assertNoHierarchyConflicts(tx, season.dramaId, [], episodesToRestore);

    const restoredEpisodes = await tx
      .update(episodes)
      .set({ deleted_at: null, updated_at: now })
      .where(and(eq(episodes.season_id, parsedId), eq(episodes.deleted_at, deletedAt)))
      .returning({ id: episodes.id });

    await tx
      .update(seasons)
      .set({ deleted_at: null, updated_at: now })
      .where(eq(seasons.id, parsedId));

    return {
      contentType: 'season',
      id: parsedId,
      restoredSeasons: 0,
      restoredEpisodes: restoredEpisodes.length,
    };
  });
}

/** Restore a trashed episode. */
export async function restoreEpisode(actor: ActorContext, episodeId: string): Promise<RestoreResult> {
  requirePermission(actor, 'episode.manage');

  const parsedId = parseOrThrow(z.uuid(), episodeId);

  return db.transaction(async tx => {
    const [episode] = await tx
      .select({
        id: episodes.id,
        dramaId: episodes.drama_id,
        seasonId: episodes.season_id,
        episodeNumber: episodes.episode_number,
        deletedAt: episodes.deleted_at,
      })
      .from(episodes)
      .where(eq(episodes.id, parsedId))
      .for('no key update')
      .limit(1);

    if (!episode) {
      throw new NotFoundError('Episode not found.');
    }

    if (episode.deletedAt === null) {
      throw new ValidationError('This episode is not in the Trash.');
    }

    const [drama] = await tx
      .select({ id: dramas.id, deletedAt: dramas.deleted_at })
      .from(dramas)
      .where(eq(dramas.id, episode.dramaId))
      .limit(1);

    if (!drama || drama.deletedAt !== null) {
      throw new ValidationError('Restore the drama before restoring its episode.');
    }

    if (episode.seasonId !== null) {
      const [season] = await tx
        .select({ id: seasons.id, deletedAt: seasons.deleted_at })
        .from(seasons)
        .where(eq(seasons.id, episode.seasonId))
        .limit(1);

      if (!season || season.deletedAt !== null) {
        throw new ValidationError('Restore the season before restoring its episode.');
      }
    }

    if (episode.episodeNumber !== null) {
      const [conflict] = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(
          and(
            eq(episodes.drama_id, episode.dramaId),
            eq(episodes.episode_number, episode.episodeNumber),
            isNull(episodes.deleted_at)
          )
        )
        .limit(1);

      if (conflict) {
        throw new ConflictError(
          'Another active episode of this drama already uses this episode number. Change it before restoring.'
        );
      }
    }

    const now = new Date();

    await tx
      .update(episodes)
      .set({ deleted_at: null, updated_at: now })
      .where(eq(episodes.id, parsedId));

    return {
      contentType: 'episode',
      id: parsedId,
      restoredSeasons: 0,
      restoredEpisodes: 0,
    };
  });
}

/** Restore a trashed movie. */
export async function restoreMovie(actor: ActorContext, movieId: string): Promise<RestoreResult> {
  requirePermission(actor, 'movie.manage');

  const parsedId = parseOrThrow(z.uuid(), movieId);

  return db.transaction(async tx => {
    const [movie] = await tx
      .select({ id: movies.id, slug: movies.slug, deletedAt: movies.deleted_at })
      .from(movies)
      .where(eq(movies.id, parsedId))
      .for('no key update')
      .limit(1);

    if (!movie) {
      throw new NotFoundError('Movie not found.');
    }

    if (movie.deletedAt === null) {
      throw new ValidationError('This movie is not in the Trash.');
    }

    const [conflict] = await tx
      .select({ id: movies.id })
      .from(movies)
      .where(and(eq(movies.slug, movie.slug), isNull(movies.deleted_at)))
      .limit(1);

    if (conflict) {
      throw new ConflictError(
        'Another active movie already uses this slug. Rename it before restoring.'
      );
    }

    await tx
      .update(movies)
      .set({ deleted_at: null, updated_at: new Date() })
      .where(eq(movies.id, parsedId));

    return {
      contentType: 'movie',
      id: parsedId,
      restoredSeasons: 0,
      restoredEpisodes: 0,
    };
  });
}

/**
 * Restore one trashed row, dispatching on its content type.
 *
 * The Trash surface is type-agnostic, so the shared entry point resolves the
 * workflow that owns the content type instead of duplicating the dispatch in
 * every route.
 */
export async function restoreTrashItem(
  actor: ActorContext,
  contentType: 'drama' | 'season' | 'episode' | 'movie',
  id: string
): Promise<RestoreResult> {
  if (contentType === 'drama') {
    return restoreDrama(actor, id);
  }

  if (contentType === 'season') {
    return restoreSeason(actor, id);
  }

  if (contentType === 'episode') {
    return restoreEpisode(actor, id);
  }

  return restoreMovie(actor, id);
}
