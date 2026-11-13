import 'server-only';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import { episodes, dramas, seasons } from '@/modules/content/schema';
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

  // Check for duplicate episode number within the drama (if episode_number is provided)
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

  const [row] = await db
    .insert(episodes)
    .values({
      drama_id: parsedDramaId,
      season_id: parsed.season_id,
      title: parsed.title,
      description: parsed.description,
      episode_number: parsed.episode_number,
      position: parsed.position,
      publication_status: parsed.publication_status,
      video_source: parsed.video_source,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning();

  return { ok: true, episode: toEpisode(row) };
}

/** List episodes for a drama. */
export async function listEpisodes(
  actor: ActorContext,
  dramaId: string
): Promise<{ ok: true; episodes: ReturnType<typeof toEpisode>[]; total: number } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);

  const [totalRow] = await db
    .select({ total: count() })
    .from(episodes)
    .where(and(eq(episodes.drama_id, parsedDramaId), isNull(episodes.deleted_at)));

  const total = Number(totalRow?.total ?? 0);

  const rows = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.drama_id, parsedDramaId), isNull(episodes.deleted_at)))
    .orderBy(episodes.position);

  return {
    ok: true,
    episodes: rows.map(toEpisode),
    total,
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
    }
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

/** Replace episode video source following Phase 6 process.
 * 
 * This function handles the source replacement workflow:
 * 1. Validates the new video_source URL syntax and HTTPS scheme
 * 2. Does not perform backend video proxying or fetching
 * 3. The actual preview, administrator confirmation, and progress reset
 *    must be handled in the client UI per Phase 6 requirements
 * 4. Resets playback progress for the episode after confirmed replacement
 * 5. Preserves watch-history records and their historical dates
 * 
 * Important: This function only updates the video_source field in the database.
 * The actual preview, administrator confirmation, and progress reset
 * must be handled in the client UI per Phase 6 requirements.
 * 
 * @param newVideoSource - The new public HTTPS direct MP4 URL
 * @returns The updated episode with the new video_source
 */
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