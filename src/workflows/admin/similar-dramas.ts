import 'server-only';

import { and, eq, desc, asc } from 'drizzle-orm';
import { parseOrThrow } from '@/modules/content/validation';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import {
  similar_dramas as similarDramas,
  dramas,
} from '@/modules/content/schema';

/** Permission key for similar drama management. */
const MANAGE_PERMISSION = 'similar-drama.manage';

/** List query schema for similar drama listing. */
const listSimilarDramasQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['title', 'createdAt']).default('title'),
  order: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().optional(),
});

/** Parse list query, throwing a REST-safe validation error on failure. */
export function parseListSimilarDramasQuery(input: unknown): z.infer<typeof listSimilarDramasQuerySchema> {
  return parseOrThrow(listSimilarDramasQuerySchema, input);
}

/** List similar dramas for a specific drama. */
export async function listSimilarDramas(
  actor: ActorContext,
  dramaId: string,
  query: z.infer<typeof listSimilarDramasQuerySchema>
): Promise<{
  ok: true;
  similar_dramas: SimilarDramaSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), dramaId);

  // Verify the drama exists
  const [drama] = await db
    .select({ id: dramas.id, title: dramas.title })
    .from(dramas)
    .where(eq(dramas.id, parsedId));

  if (!drama) {
    return { ok: false, similar_dramas: [], total: 0, page: 1, pageSize: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false };
  }

  const offset = (query.page - 1) * query.pageSize;

  // Build WHERE conditions
  const whereConditions: any[] = [eq(similarDramas.drama_id, parsedId)];

  // Search filter (similar drama title)
  if (query.search) {
    const searchPattern = `%${query.search}%`;
    whereConditions.push(
      sql`SELECT id FROM dramas WHERE title ILIKE ${searchPattern} AND deleted_at IS NULL`
    );
  }

  // Count total
  const [totalRow] = await db
    .select({ total: sql`count(*)::int` })
    .from(similarDramas)
    .where(and(...whereConditions));

  const total = Number(totalRow?.total ?? 0);

  // Build ORDER BY
  const sortColumn =
    query.sort === 'title'
      ? dramas.title
      : dramas.created_at;
  const sortOrder = query.order === 'desc' ? desc : asc;
  const orderBy = sortOrder(sortColumn);

  // Fetch similar dramas with pagination
  const rows = await db
    .select({
      id: similarDramas.similar_drama_id,
      title: dramas.title,
      poster: dramas.poster,
      description: dramas.description,
      position: similarDramas.position,
    })
    .from(similarDramas)
    .leftJoin(dramas, eq(similarDramas.similar_drama_id, dramas.id))
    .where(and(...whereConditions))
    .orderBy(orderBy)
    .limit(query.pageSize)
    .offset(offset);

  return {
    ok: true,
    similar_dramas: rows.map(row => ({
      id: row.id,
      title: row.title,
      poster: row.poster,
      description: row.description,
      position: row.position,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    hasNextPage: query.page < Math.ceil(total / query.pageSize),
    hasPreviousPage: query.page > 1,
  };
}

/** Add a similar drama association. */
export async function addSimilarDrama(
  actor: ActorContext,
  dramaId: string,
  similarDramaId: string
): Promise<{ ok: true; similar_drama: SimilarDramaSummary } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);
  const parsedSimilarDramaId = parseOrThrow(z.uuid(), similarDramaId);

  // Verify both dramas exist
  const [drama] = await db
    .select({ id: dramas.id, title: dramas.title })
    .from(dramas)
    .where(eq(dramas.id, parsedDramaId));

  const [similarDrama] = await db
    .select({ id: dramas.id, title: dramas.title })
    .from(dramas)
    .where(eq(dramas.id, parsedSimilarDramaId));

  if (!drama) {
    return { ok: false, error: new NotFoundError('Drama not found.') };
  }

  if (!similarDrama) {
    return { ok: false, error: new NotFoundError('Similar drama not found.') };
  }

  // Cannot add a drama as similar to itself
  if (parsedDramaId === parsedSimilarDramaId) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A drama cannot be similar to itself.',
      },
    };
  }

  // Check if association already exists
  const [existing] = await db
    .select({ id: similarDramas.drama_id })
    .from(similarDramas)
    .where(
      and(
        eq(similarDramas.drama_id, parsedDramaId),
        eq(similarDramas.similar_drama_id, parsedSimilarDramaId)
      )
    );

  if (existing) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'This drama is already marked as similar to the selected drama.',
      },
    };
  }

  const [row] = await db
    .insert(similarDramas)
    .values({
      drama_id: parsedDramaId,
      similar_drama_id: parsedSimilarDramaId,
      position: 0,
    })
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Failed to create similar drama association.') };
  }

  return { ok: true, similar_drama: toSimilarDramaSummary(row) };
}

/** Remove a similar drama association. */
export async function removeSimilarDrama(
  actor: ActorContext,
  dramaId: string,
  similarDramaId: string
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);
  const parsedSimilarDramaId = parseOrThrow(z.uuid(), similarDramaId);

  const [row] = await db
    .delete(similarDramas)
    .where(
      and(
        eq(similarDramas.drama_id, parsedDramaId),
        eq(similarDramas.similar_drama_id, parsedSimilarDramaId)
      )
    )
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Similar drama association not found.') };
  }

  return { ok: true };
}

/** Update the position of a similar drama association. */
export async function updateSimilarDramaPosition(
  actor: ActorContext,
  dramaId: string,
  similarDramaId: string,
  position: number
): Promise<{ ok: true; similar_drama: SimilarDramaSummary } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedDramaId = parseOrThrow(z.uuid(), dramaId);
  const parsedSimilarDramaId = parseOrThrow(z.uuid(), similarDramaId);

  const [row] = await db
    .update(similarDramas)
    .set({ position })
    .where(
      and(
        eq(similarDramas.drama_id, parsedDramaId),
        eq(similarDramas.similar_drama_id, parsedSimilarDramaId)
      )
    )
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Similar drama association not found.') };
  }

  return { ok: true, similar_drama: toSimilarDramaSummary(row) };
}

/** Similar drama summary type. */
type SimilarDramaSummary = {
  id: string;
  title: string;
  poster: string | null;
  description: string | null;
  position: number;
};

/** Parse similar drama form input. */
const similarDramaFormSchema = z.strictObject({
  similar_drama_id: z.string().uuid(),
  position: z.coerce.number().int().min(0).default(0),
});

export type { similarDramaFormSchema };

/** Convert database row to summary. */
function toSimilarDramaSummary(row: {
  similar_drama_id: string;
  dramas: {
    id: string;
    title: string;
    poster: string | null;
    description: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    description: string | null;
    title: string;
    slug: string;
    poster: string | null;
    banner: string | null;
    status: string | null;
    publication_status: string;
    structure_type: string;
    visibility: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
}): SimilarDramaSummary => ({
  id: row.similar_drama_id,
  title: row.dramas.title,
  poster: row.dramas.poster,
  description: row.dramas.description,
  position: row.position,
});