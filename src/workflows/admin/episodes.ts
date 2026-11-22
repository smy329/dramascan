import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { NotFoundError, ValidationError } from '@/platform/errors';

import { z } from 'zod';
import { episodes, dramas, seasons } from '@/modules/content/schema';
import {
  parseOrThrow,
  parseCreateEpisodeInput,
  publicationReadyVideoSourceSchema,
} from '@/modules/content/validation';
import { evaluatePublicAvailability } from '@/modules/content/publication';

/** Permission key for episode management. */
const MANAGE_PERMISSION = 'episode.manage';

/** Episode create. */
export async function createEpisode(
  actor: ActorContext,
  dramaId: string,
  input: unknown
): Promise<{ ok: true; episode: ReturnType<typeof toEpisode> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  // Parse episode input
  const parsed = parseCreateEpisodeInput(input);

  return db.transaction(async tx => {
    // Lock the parent drama for the whole allocation. The lock proves the drama
    // exists and serializes number and position allocation for its episodes, so
    // two concurrent creates cannot both read the same maximum and produce a
    // duplicate (H-07). It also holds across processes, not only within one
    // Node process.
    const [drama] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, parsedDramaId))
      .for('no key update')
      .limit(1);

    if (!drama) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    // If season_id is provided, check the season exists, belongs to this drama,
    // and is not trashed. A trashed season must not receive new episodes.
    if (parsed.season_id) {
      const [season] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(
          and(
            eq(seasons.id, parsed.season_id),
            eq(seasons.drama_id, parsedDramaId),
            isNull(seasons.deleted_at)
          )
        );

      if (!season) {
        return {
          ok: false as const,
          error: new NotFoundError('Season not found or does not belong to this drama.'),
        };
      }
    }

    // Numbering is drama-wide: an episode number identifies an episode inside
    // its drama, regardless of which season holds it.
    if (parsed.episode_number !== undefined) {
      const [existing] = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(
          and(
            eq(episodes.drama_id, parsedDramaId),
            eq(episodes.episode_number, parsed.episode_number),
            isNull(episodes.deleted_at)
          )
        );

      if (existing) {
        return {
          ok: false as const,
          error: {
            code: 'validation_error',
            message: 'An episode with this episode number already exists.',
            fieldErrors: {
              episode_number: ['An episode with this episode number already exists.'],
            },
          },
        };
      }
    }

    const [maxRow] = await tx
      .select({ max: sql`MAX(${episodes.episode_number})` })
      .from(episodes)
      .where(and(eq(episodes.drama_id, parsedDramaId), isNull(episodes.deleted_at)));

    const episodeNumber = parsed.episode_number ?? Number(maxRow?.max ?? 0) + 1;

    // An omitted position appends inside the episode's own ordering scope: the
    // season when it has one, the unseasoned set otherwise. Two episodes never
    // share a position by accident.
    const positionScope = parsed.season_id
      ? and(
          eq(episodes.drama_id, parsedDramaId),
          eq(episodes.season_id, parsed.season_id),
          isNull(episodes.deleted_at)
        )
      : and(
          eq(episodes.drama_id, parsedDramaId),
          isNull(episodes.season_id),
          isNull(episodes.deleted_at)
        );

    const [maxPositionRow] = await tx
      .select({ max: sql`MAX(${episodes.position})` })
      .from(episodes)
      .where(positionScope);

    const position = parsed.position ?? Number(maxPositionRow?.max ?? -1) + 1;

    const [row] = await tx
      .insert(episodes)
      .values({
        drama_id: parsedDramaId,
        season_id: parsed.season_id,
        title: parsed.title,
        description: parsed.description,
        episode_number: episodeNumber,
        position,
        video_source: parsed.video_source,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    if (!row) {
      return { ok: false as const, error: new NotFoundError('Episode not found.') };
    }

    return { ok: true as const, episode: toEpisode(row) };
  });
}

/**
 * Move episodes between seasons within the same drama.
 *
 * Every episode keeps its drama and its episode number: a move changes the
 * season and the ordering position only. The parent drama row is locked for the
 * whole move, so a concurrent create or reorder in the same drama cannot
 * interleave with the position allocation (H-07).
 */
export async function moveEpisodesToSeason(
  actor: ActorContext,
  dramaId: string,
  episodeIds: string[],
  targetSeasonId: string | null
): Promise<{ ok: true; episodesMoved: number } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  if (episodeIds.length === 0) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'Select at least one episode to move.',
        fieldErrors: { episodeIds: ['Select at least one episode to move.'] },
      },
    };
  }

  const parsedEpisodeIds = episodeIds.map(id => parseOrThrow(z.uuid(), id));
  const requestedIds = new Set(parsedEpisodeIds);

  // A repeated id would move the same episode twice and inflate the reported
  // count, so the request is rejected instead of silently deduplicated.
  if (requestedIds.size !== parsedEpisodeIds.length) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'The same episode cannot be selected twice.',
        fieldErrors: { episodeIds: ['The same episode cannot be selected twice.'] },
      },
    };
  }

  const parsedTargetSeasonId = targetSeasonId ? parseOrThrow(z.uuid(), targetSeasonId) : null;

  return db.transaction(async tx => {
    const [drama] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, parsedDramaId))
      .for('no key update')
      .limit(1);

    if (!drama) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    if (parsedTargetSeasonId) {
      const [targetSeason] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(
          and(
            eq(seasons.id, parsedTargetSeasonId),
            eq(seasons.drama_id, parsedDramaId),
            isNull(seasons.deleted_at)
          )
        );

      if (!targetSeason) {
        return {
          ok: false as const,
          error: new NotFoundError('Target season not found or does not belong to this drama.'),
        };
      }
    }

    // Lock the rows being moved, in id order, so two opposing moves cannot
    // deadlock and the set cannot change between validation and update.
    const episodesToMove = await tx
      .select({ id: episodes.id, position: episodes.position })
      .from(episodes)
      .where(
        and(
          eq(episodes.drama_id, parsedDramaId),
          isNull(episodes.deleted_at),
          inArray(episodes.id, parsedEpisodeIds)
        )
      )
      .orderBy(asc(episodes.id))
      .for('update');

    const foundIds = new Set(episodesToMove.map(row => row.id));

    if (foundIds.size !== requestedIds.size) {
      const missingIds = [...requestedIds].filter(id => !foundIds.has(id));

      return {
        ok: false as const,
        error: {
          code: 'not_found',
          message: `One or more episodes not found or do not belong to this drama: ${missingIds.join(', ')}`,
        },
      };
    }

    // Append after the target scope's current maximum, ignoring the episodes
    // that are moving so a move within the same season does not push them past
    // the episodes that stay behind.
    const targetScope = parsedTargetSeasonId
      ? and(
          eq(episodes.drama_id, parsedDramaId),
          eq(episodes.season_id, parsedTargetSeasonId),
          isNull(episodes.deleted_at)
        )
      : and(
          eq(episodes.drama_id, parsedDramaId),
          isNull(episodes.season_id),
          isNull(episodes.deleted_at)
        );

    const [maxPosRow] = await tx
      .select({ max: sql`MAX(${episodes.position})` })
      .from(episodes)
      .where(and(targetScope, notInArray(episodes.id, parsedEpisodeIds)));

    const targetPosition = Number(maxPosRow?.max ?? -1) + 1;

    for (let index = 0; index < episodesToMove.length; index += 1) {
      await tx
        .update(episodes)
        .set({
          season_id: parsedTargetSeasonId,
          position: targetPosition + index,
          updated_at: new Date(),
        })
        .where(eq(episodes.id, episodesToMove[index]!.id));
    }

    return { ok: true as const, episodesMoved: episodesToMove.length };
  });
}

/**
 * Renumber the episodes of a drama.
 *
 * Episode numbers are unique per drama, so an explicit renumber is the only
 * operation allowed to rewrite them (requirements 4.7: reordering and deletion
 * must never silently change numbers).
 *
 * The rewrite is two-phase inside one transaction. Assigning the final numbers
 * directly can collide with a number that has not been rewritten yet (swapping
 * episodes 1 and 2 is the smallest example), so every affected number is
 * cleared first and the new numbers are assigned afterwards.
 *
 * The numbering is drama-wide: the second season continues after the first one
 * (D-032). A season-scoped renumber cannot produce such a sequence, so it is
 * refused instead of being answered with a different result than the
 * administrator asked for.
 */
export async function renumberEpisodes(
  actor: ActorContext,
  dramaId: string,
  seasonId?: string | null
): Promise<{ ok: true; episodesModified: number } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  if (seasonId !== undefined && seasonId !== null) {
    return {
      ok: false as const,
      error: {
        code: 'validation_error',
        message: 'Episode numbering is drama-wide. Renumber the whole drama.',
        fieldErrors: {
          seasonId: ['Episode numbering is drama-wide. Renumber the whole drama.'],
        },
      },
    };
  }

  return db.transaction(async tx => {
    const [drama] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, parsedDramaId))
      .for('no key update')
      .limit(1);

    if (!drama) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    // Order by the drama-wide display order: seasons by position, episodes
    // inside a season by position. Seasonless episodes come last. A subquery
    // keeps the single statement lockable; an outer join would not be.
    const rows = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.drama_id, parsedDramaId), isNull(episodes.deleted_at)))
      .orderBy(
        asc(
          sql`coalesce((SELECT s.position FROM seasons s WHERE s.id = ${episodes.season_id}), 2147483647)`
        ),
        asc(episodes.position),
        asc(episodes.id)
      )
      .for('update');

    if (rows.length === 0) {
      return { ok: true as const, episodesModified: 0 };
    }

    await tx
      .update(episodes)
      .set({ episode_number: null })
      .where(
        inArray(
          episodes.id,
          rows.map(row => row.id)
        )
      );

    for (let index = 0; index < rows.length; index += 1) {
      await tx
        .update(episodes)
        .set({ episode_number: index + 1, updated_at: new Date() })
        .where(eq(episodes.id, rows[index]!.id));
    }

    return { ok: true as const, episodesModified: rows.length };
  });
}

/**
 * Reorder episodes by specifying their new order.
 *
 * Positions are rewritten for exactly the episodes named, in the given order,
 * starting at zero. The parent drama row is locked so a concurrent create,
 * move, or reorder in the same drama cannot interleave (H-07).
 */
export async function reorderEpisodes(
  actor: ActorContext,
  dramaId: string,
  episodeIds: string[]
): Promise<{ ok: true; episodesReordered: number } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  if (episodeIds.length === 0) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'Select at least one episode to reorder.',
        fieldErrors: { episodeIds: ['Select at least one episode to reorder.'] },
      },
    };
  }

  const parsedEpisodeIds = episodeIds.map(id => parseOrThrow(z.uuid(), id));
  const requestedSet = new Set(parsedEpisodeIds);

  // A repeated id would give the same episode two positions; the last write
  // would win and another episode would keep a stale position, so the request
  // is rejected rather than silently deduplicated.
  if (requestedSet.size !== parsedEpisodeIds.length) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'The same episode cannot appear twice in the requested order.',
        fieldErrors: {
          episodeIds: ['The same episode cannot appear twice in the requested order.'],
        },
      },
    };
  }

  return db.transaction(async tx => {
    const [drama] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, parsedDramaId))
      .for('no key update')
      .limit(1);

    if (!drama) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    // Validate that all episode IDs belong to this drama and are not deleted.
    const validEpisodes = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.drama_id, parsedDramaId),
          isNull(episodes.deleted_at),
          inArray(episodes.id, parsedEpisodeIds)
        )
      )
      .orderBy(asc(episodes.id))
      .for('update');

    const foundSet = new Set(validEpisodes.map(row => row.id));

    if (foundSet.size !== requestedSet.size) {
      return {
        ok: false as const,
        error: new NotFoundError('One or more episodes not found or do not belong to this drama.'),
      };
    }

    for (let index = 0; index < parsedEpisodeIds.length; index += 1) {
      await tx
        .update(episodes)
        .set({ position: index, updated_at: new Date() })
        .where(eq(episodes.id, parsedEpisodeIds[index]!));
    }

    return { ok: true as const, episodesReordered: parsedEpisodeIds.length };
  });
}

/** List episodes for a drama with pagination, sorting, and search. */
export async function listEpisodes(
  actor: ActorContext,
  dramaId: string,
  query: unknown
): Promise<{
  ok: true;
  episodes: ReturnType<typeof toEpisode>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  // Parse and validate query parameters
  const parsedQuery = parseOrThrow(listEpisodesQuerySchema, query);

  // Base where conditions: drama must exist and episode not soft-deleted
  const whereConditions = [eq(episodes.drama_id, parsedDramaId), isNull(episodes.deleted_at)];

  // Add publication_status filter if provided
  if (parsedQuery.publication_status) {
    whereConditions.push(eq(episodes.publication_status, parsedQuery.publication_status));
  }

  // Add search filter if provided (search by title or episode_number).
  //
  // The alternatives are wrapped in their own `or(...)`. A bare `OR` inside
  // `and(...)` lets SQL precedence decide the grouping, which drops the parent
  // and deleted predicates from the `OR` branch and returns another drama's or
  // a trashed episode (M-01).
  if (parsedQuery.search) {
    const searchPattern = `%${parsedQuery.search}%`;
    whereConditions.push(
      or(
        ilike(episodes.title, searchPattern),
        sql`CAST(${episodes.episode_number} AS text) ILIKE ${searchPattern}`
      )!
    );
  }

  // Determine sorting
  const sortColumns = {
    title: episodes.title,
    episode_number: episodes.episode_number,
    position: episodes.position,
    publication_status: episodes.publication_status,
  } as const;

  const requestedSort = parsedQuery.sort ?? 'position';
  const sortKey =
    requestedSort in sortColumns ? (requestedSort as keyof typeof sortColumns) : 'position';
  const sortColumn = sortColumns[sortKey];
  const sortDirection = parsedQuery.order === 'desc' ? desc : asc;

  // Count total matching episodes
  const [totalRow] = await db
    .select({ total: count() })
    .from(episodes)
    .where(and(...whereConditions));

  const total = Number(totalRow?.total ?? 0);

  // Calculate pagination
  const page = Math.max(1, parsedQuery.page ?? 1);
  const pageSize = Math.min(Math.max(1, parsedQuery.pageSize ?? 20), 100);
  const offset = (page - 1) * pageSize;

  // Fetch episodes with pagination. The id tiebreaker makes equal sort values
  // deterministic, so a page cannot repeat or skip an episode between requests.
  const rows = await db
    .select({ episode: episodes, drama: dramas, season: seasons })
    .from(episodes)
    .innerJoin(dramas, eq(episodes.drama_id, dramas.id))
    .leftJoin(seasons, eq(episodes.season_id, seasons.id))
    .where(and(...whereConditions))
    .limit(pageSize)
    .offset(offset)
    .orderBy(sortDirection(sortColumn), sortDirection(episodes.id));

  const totalPages = Math.ceil(total / pageSize);

  return {
    ok: true,
    episodes: rows.map(row => ({
      ...toEpisode(row.episode),
      publiclyAvailable: evaluatePublicAvailability({
        contentType: 'episode',
        publicationStatus: (row.episode.publication_status ?? 'draft') as
          'draft' | 'published' | 'unpublished',
        deleted: row.episode.deleted_at !== null,
        parentDrama: {
          publicationStatus: (row.drama.publication_status ?? 'draft') as
            'draft' | 'published' | 'unpublished',
          deleted: row.drama.deleted_at !== null,
        },
        parentSeason: row.season
          ? {
              publicationStatus: (row.season.publication_status ?? 'draft') as
                'draft' | 'published' | 'unpublished',
              deleted: row.season.deleted_at !== null,
            }
          : null,
      }).publiclyAvailable,
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Episode update.
 *
 * The episode's real parent drama is loaded from the row. The duplicate-number
 * check and the season-ownership check are both scoped to that drama; comparing
 * `episodes.drama_id` or `seasons.drama_id` to the episode id never matched, so
 * both guards silently admitted every input (H-05).
 */
export async function updateEpisode(
  actor: ActorContext,
  episodeId: string,
  input: unknown
): Promise<{ ok: true; episode: ReturnType<typeof toEpisode> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedEpisodeId = parseOrThrow(z.uuid(), episodeId);
  const episodeSchema = z.strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().optional(),
    episode_number: z.coerce.number().int().min(1).optional(),
    position: z.coerce.number().int().min(0).optional(),
    season_id: z.string().uuid().optional(),
    video_source: publicationReadyVideoSourceSchema.optional(),
  });

  const parsed = parseOrThrow(episodeSchema, input);

  return db.transaction(async tx => {
    // The parent drama must be locked before the episode row: every writer in
    // this module takes the drama lock first, so taking them in the opposite
    // order here would let a concurrent move deadlock against an update.
    const [target] = await tx
      .select({ id: episodes.id, drama_id: episodes.drama_id })
      .from(episodes)
      .where(eq(episodes.id, parsedEpisodeId))
      .limit(1);

    if (!target) {
      return { ok: false as const, error: new NotFoundError('Episode not found.') };
    }

    await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, target.drama_id))
      .for('no key update')
      .limit(1);

    const [episode] = await tx
      .select({ id: episodes.id, drama_id: episodes.drama_id })
      .from(episodes)
      .where(eq(episodes.id, parsedEpisodeId))
      .for('no key update')
      .limit(1);

    if (!episode) {
      return { ok: false as const, error: new NotFoundError('Episode not found.') };
    }

    // Check for duplicate episode number (excluding the current episode)
    if (parsed.episode_number !== undefined) {
      const [conflict] = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(
          and(
            eq(episodes.drama_id, episode.drama_id),
            eq(episodes.episode_number, parsed.episode_number),
            isNull(episodes.deleted_at),
            ne(episodes.id, parsedEpisodeId)
          )
        );

      if (conflict) {
        return {
          ok: false as const,
          error: {
            code: 'validation_error',
            message: 'An episode with this episode number already exists.',
            fieldErrors: {
              episode_number: ['An episode with this episode number already exists.'],
            },
          },
        };
      }
    }

    // If season_id is being changed, validate the new season belongs to the
    // episode's drama and is not trashed.
    if (parsed.season_id !== undefined) {
      const [season] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(
          and(
            eq(seasons.id, parsed.season_id),
            eq(seasons.drama_id, episode.drama_id),
            isNull(seasons.deleted_at)
          )
        );

      if (!season) {
        return {
          ok: false as const,
          error: new NotFoundError('Season not found or does not belong to this drama.'),
        };
      }
    }

    const [row] = await tx
      .update(episodes)
      .set({
        title: parsed.title,
        description: parsed.description,
        episode_number: parsed.episode_number,
        position: parsed.position,
        season_id: parsed.season_id,
        video_source: parsed.video_source,
        updated_at: new Date(),
      })
      .where(eq(episodes.id, parsedEpisodeId))
      .returning();

    if (!row) {
      return { ok: false as const, error: new NotFoundError('Episode not found.') };
    }

    return { ok: true as const, episode: toEpisode(row) };
  });
}

/** Soft-delete an episode (mark deleted_at). */
export async function deleteEpisode(
  actor: ActorContext,
  episodeId: string
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedEpisodeId = parseOrThrow(z.uuid(), episodeId);

  return db.transaction(async tx => {
    // An episode that is already in the Trash keeps the timestamp of the
    // cascade that put it there. Re-trashing it would detach it from that
    // cascade and break the exact restoration of the hierarchy.
    const [row] = await tx
      .update(episodes)
      .set({ deleted_at: new Date() })
      .where(and(eq(episodes.id, parsedEpisodeId), isNull(episodes.deleted_at)))
      .returning();

    if (!row) {
      const [existing] = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(eq(episodes.id, parsedEpisodeId))
        .limit(1);

      if (!existing) {
        return { ok: false as const, error: new NotFoundError('Episode not found.') };
      }

      return {
        ok: false as const,
        error: new ValidationError('This episode is already in the Trash.'),
      };
    }

    return { ok: true as const };
  });
}

/** Replace episode video source following Phase 6 process. */
export async function replaceEpisodeVideoSource(
  actor: ActorContext,
  episodeId: string,
  newVideoSource: string
): Promise<{ ok: true; episode: ReturnType<typeof toEpisode> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  // Validate URL syntax, HTTPS scheme, credentials, and the .mp4 path format.
  const parsedUrl = parseOrThrow(publicationReadyVideoSourceSchema, newVideoSource);

  // Check episode exists
  const [episode] = await db
    .select({ id: episodes.id, title: episodes.title, drama_id: episodes.drama_id })
    .from(episodes)
    .where(eq(episodes.id, parseOrThrow(z.uuid(), episodeId)));

  if (!episode) {
    return { ok: false, error: new NotFoundError('Episode not found.') };
  }

  // Update only the video_source - no backend proxying, no fetching,
  // no transcoding, no staging. The URL is stored as-is for direct browser playback.
  const [row] = await db
    .update(episodes)
    .set({
      video_source: parsedUrl,
      updated_at: new Date(),
    })
    .where(eq(episodes.id, parseOrThrow(z.uuid(), episodeId)))
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Episode not found.') };
  }

  return { ok: true, episode: toEpisode(row) };
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

/** Zod schema for listEpisodes query parameters. */
const listEpisodesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sort: z
      .enum(['title', 'episode_number', 'position', 'publication_status', 'createdAt'])
      .optional(),
    order: z.enum(['asc', 'desc']).optional(),
    search: z.string().trim().optional(),
    publication_status: z.enum(['draft', 'published', 'unpublished']).optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'At least one query parameter must be provided.',
  });
