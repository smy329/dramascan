import 'server-only';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import { episodes, dramas } from '@/modules/content/schema';
import { parseOrThrow, parseCreateEpisodeInput, type CreateEpisodeInput } from '@/modules/content/validation';

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

  // Check drama exists
  const [drama] = await db
    .select({ title: dramas.title })
    .from(dramas)
    .where(eq(dramas.id, parsedDramaId));

  if (!drama) {
    return { ok: false, error: new NotFoundError('Drama not found.') };
  }

  // Parse episode input
  const parsed = parseOrThrow(parseCreateEpisodeInput, input);

  // If season_id is provided, check the season exists and belongs to the drama
  if (parsed.season_id) {
    const [season] = await db
      .select({ id: seasons.id, title: seasons.title, drama_id: seasons.drama_id })
      .from(seasons)
      .where(and(eq(seasons.id, parsed.season_id), eq(seasons.drama_id, parsedDramaId)));

    if (!season) {
      return { ok: false, error: new NotFoundError('Season not found or does not belong to this drama.') };
    }
  }

  // Determine episode_number: use provided value, or auto-assign the next number
  let episodeNumber: number | undefined;
  if (parsed.episode_number !== undefined) {
    // User provided an explicit episode number - validate no duplicate
    if (parsed.episode_number !== undefined) {
      const [existing] = await db
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
          ok: false,
          error: {
            code: 'validation_error',
            message: 'An episode with this episode number already exists.',
            fieldErrors: { episode_number: ['An episode with this episode number already exists.'] },
          },
        };
      }
    }
    episodeNumber = parsed.episode_number;
  } else {
    // Auto-assign the next episode number
    // Find the max episode_number for this drama (or within this season if season_id provided)
    const [maxRow] = await db
      .select({ max: sql`MAX(${episodes.episode_number})` })
      .from(episodes)
      .where(
        and(
          eq(episodes.drama_id, parsedDramaId),
          isNull(episodes.deleted_at),
          ...(parsed.season_id
            ? [eq(episodes.season_id, parsed.season_id)]
            : [])
        )
      );

    const currentMax = Number(maxRow?.max);
    episodeNumber = currentMax !== null && currentMax !== undefined ? currentMax + 1 : 1;
  }

  const [row] = await db
    .insert(episodes)
    .values({
      drama_id: parsedDramaId,
      season_id: parsed.season_id,
      title: parsed.title,
      description: parsed.description,
      episode_number: episodeNumber,
      position: parsed.position,
      publication_status: parsed.publication_status,
      video_source: parsed.video_source,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning();

  return { ok: true, episode: toEpisode(row) };
}

/** Renumber episodes in a drama (or within a season). */
export async function renumberEpisodes(
  actor: ActorContext,
  dramaId: string,
  seasonId: string | null
): Promise<{ ok: true; episodesModified: number } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  // Build where conditions based on whether we're renumbering by season or for the whole drama
  const whereConditions = [
    eq(episodes.drama_id, parsedDramaId),
    isNull(episodes.deleted_at),
  ];

  if (seasonId) {
    const parsedSeasonId = parseOrThrow(z.uuid(), seasonId);
    whereConditions.push(eq(episodes.season_id, parsedSeasonId));
  }

  // Get all episodes in order by current position
  const rows = await db
    .select()
    .from(episodes)
    .where(and(...whereConditions))
    .orderBy(episodes.position);

  // Renumber episodes sequentially starting from 1
  const updatePromises = rows.map((row, index) =>
    db
      .update(episodes)
      .set({ episode_number: index + 1 })
      .where(eq(episodes.id, row.id))
  );

  await Promise.all(updatePromises);

  return {
    ok: true,
    episodesModified: rows.length,
  };
}

/** Reorder episodes by specifying their new order. */
export async function reorderEpisodes(
  actor: ActorContext,
  dramaId: string,
  episodeIds: string[]
): Promise<{ ok: true; episodesReordered: number } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  // Validate that all episode IDs belong to this drama and are not deleted
  const validEpisodes = await db
    .select({ id: episodes.id, position: episodes.position, episode_number: episodes.episode_number, season_id: episodes.season_id })
    .from(episodes)
    .where(
      and(
        eq(episodes.drama_id, parsedDramaId),
        isNull(episodes.deleted_at),
        episodes.id.in(episodeIds.map(parseOrThrow(z.uuid, [])))
      )
    );

  // Verify all requested episodes were found and belong to this drama
  const requestedSet = new Set(episodeIds.map((id) => parseOrThrow(z.uuid, [])));
  const foundSet = new Set(validEpisodes.map((e) => e.id));

  if (requestedSet.size !== foundSet.size) {
    return { ok: false, error: new NotFoundError('One or more episodes not found or do not belong to this drama.') };
  }

  // Get current positions and sort by requested order
  const episodeMap = new Map(validEpisodes.map((e) => [e.id, e]));

  // Update positions based on the order provided
  // Position 0 = first, Position 1 = second, etc.
  const updatePromises = episodeIds.map((episodeId, index) => {
    const episode = episodeMap.get(episodeId);
    if (!episode) {
      return Promise.resolve(); // Should not happen due to validation above
    }
    return db
      .update(episodes)
      .set({ position: index })
      .where(eq(episodes.id, episodeId));
  });

  await Promise.all(updatePromises);

  return {
    ok: true,
    episodesReordered: episodeIds.length,
  };
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
} | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  // Parse and validate query parameters
  const parsedQuery = parseOrThrow(listEpisodesQuerySchema, query);

  // Base where conditions: drama must exist and episode not soft-deleted
  const whereConditions = [
    eq(episodes.drama_id, parsedDramaId),
    isNull(episodes.deleted_at),
  ];

  // Add publication_status filter if provided
  if (parsedQuery.publication_status) {
    whereConditions.push(eq(episodes.publication_status, parsedQuery.publication_status));
  }

  // Add search filter if provided (search by title or episode_number)
  if (parsedQuery.search) {
    const searchPattern = `%${parsedQuery.search}%`;
    whereConditions.push(
      sql`${episodes.title} ILIKE ${searchPattern} OR CAST(${episodes.episode_number} AS text) ILIKE ${searchPattern}`
    );
  }

  // Determine sorting
  const sortColumn = parsedQuery.sort || 'position';
  const sortOrder = parsedQuery.order || 'asc';

  // Validate sort column - only allow known columns
  const allowedSortColumns = ['title', 'episode_number', 'position', 'publication_status'];
  const validatedSortColumn = allowedSortColumns.includes(sortColumn) ? sortColumn : 'position';

  // Add order BY
  const sortDirection = sortOrder === 'desc' ? desc : asc;
  whereConditions.push(sortDirection(episodes[validatedSortColumn]));

  // Count total matching episodes
  const [totalRow] = await db
    .select({ total: count() })
    .from(episodes)
    .where(and(...whereConditions));

  const total = Number(totalRow?.total ?? 0);

  // Calculate pagination
  const page = Math.max(1, (parsedQuery.page ?? 1));
  const pageSize = Math.min(
    Math.max(1, parsedQuery.pageSize ?? 20),
    100
  );
  const offset = (page - 1) * pageSize;

  // Fetch episodes with pagination
  const rows = await db
    .select()
    .from(episodes)
    .where(and(...whereConditions))
    .limit(pageSize)
    .offset(offset)
    .orderBy(sortDirection(episodes[validatedSortColumn]));

  const totalPages = Math.ceil(total / pageSize);

  return {
    ok: true,
    episodes: rows.map(toEpisode),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/** Episode update. */
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
    publication_status: z.enum(['ongoing', 'completed']).optional(),
    season_id: z.string().uuid().optional(),
    video_source: z.string().url().optional(),
  });

  const parsed = parseOrThrow(episodeSchema, input);

  // Check for duplicate episode number (excluding current episode)
  if (parsed.episode_number !== undefined) {
    const [conflict] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.drama_id, parsedEpisodeId),
          eq(episodes.episode_number, parsed.episode_number),
          isNull(episodes.deleted_at),
          ne(episodes.id, parsedEpisodeId)
        )
      );

    if (conflict) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: 'An episode with this episode number already exists.',
          fieldErrors: { episode_number: ['An episode with this episode number already exists.'] },
        },
      };
    };
  }

  // If season_id is being changed, validate the new season belongs to the drama
  if (parsed.season_id !== undefined && parsed.season_id !== null) {
    const [season] = await db
      .select({ id: seasons.id, drama_id: seasons.drama_id })
      .from(seasons)
      .where(and(eq(seasons.id, parsed.season_id), eq(seasons.drama_id, parsedEpisodeId)));

    if (!season) {
      return { ok: false, error: new NotFoundError('Season not found or does not belong to this drama.') };
    }
  }

  const [row] = await db
    .update(episodes)
    .set({
      title: parsed.title,
      description: parsed.description,
      episode_number: parsed.episode_number,
      position: parsed.position,
      publication_status: parsed.publication_status,
      season_id: parsed.season_id,
      video_source: parsed.video_source,
      updated_at: new Date(),
    })
    .where(eq(episodes.id, parsedEpisodeId))
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Episode not found.') };
  }

  return { ok: true, episode: toEpisode(row) };
}

/** Soft-delete an episode (mark deleted_at). */
export async function deleteEpisode(
  actor: ActorContext,
  episodeId: string
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedEpisodeId = parseOrThrow(z.uuid(), episodeId);

  const [row] = await db
    .update(episodes)
    .set({ deleted_at: new Date() })
    .where(eq(episodes.id, parsedEpisodeId))
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Episode not found.') };
  }

  return { ok: true };
}

/** Replace episode video source following Phase 6 process. */
export async function replaceEpisodeVideoSource(
  actor: ActorContext,
  episodeId: string,
  newVideoSource: string
): Promise<{ ok: true; episode: ReturnType<typeof toEpisode> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  // Validate URL syntax and HTTPS scheme
  const urlSchema = z.string().url().refine((url) => {
    try {
      new URL(url);
      return url.startsWith('https:');
    } catch {
      return false;
    }
  });

  const parsedUrl = parseOrThrow(urlSchema, newVideoSource);

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
    pageSize: z
      .coerce.number().int().min(1).max(100)
      .default(20),
    sort: z
      .enum(['title', 'episode_number', 'position', 'publication_status', 'createdAt'])
      .optional(),
    order: z.enum(['asc', 'desc']).optional(),
    search: z.string().trim().optional(),
    publication_status: z.enum(['ongoing', 'completed']).optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one query parameter must be provided.' }
  );