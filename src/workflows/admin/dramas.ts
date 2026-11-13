import 'server-only';

import { and, eq, isNull, ne, sql, ilike } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import { dramaStatusSchema } from '@/modules/content/validation';
import { dramas, contentSlugHistory, dramaCategories, dramaPlatforms, categories, platforms } from '@/modules/content/schema';
import { parseOrThrow, parseCreateDramaInput, type CreateDramaInput } from '@/modules/content/validation';

/** Permission key for drama management. */
const MANAGE_PERMISSION = 'drama.manage';

/** List query schema for drama listing. */
const listDramasQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['title', 'status', 'createdAt']).default('title'),
  order: z.enum(['asc', 'desc']).default('asc'),
  status: z.enum(['draft', 'published', 'unpublished', 'trashed']).optional(),
  search: z.string().optional(),
});

/** Drama list query input type. */
export type ListDramasQuery = z.infer<typeof listDramasQuerySchema>;

/** Parse list query, throwing a REST-safe validation error on failure. */
export function parseListDramasQuery(input: unknown): ListDramasQuery {
  return parseOrThrow(listDramasQuerySchema, input);
}

/** Drama create. */
export async function createDrama(
  actor: ActorContext,
  input: unknown
): Promise<{ ok: true; drama: ReturnType<typeof toDrama> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsed = parseOrThrow(createDramaSchema, input);

  // Check for duplicate slug
  const [existing] = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(and(eq(dramas.slug, parsed.slug), isNull(dramas.deleted_at)));

  if (existing) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A drama with this slug already exists.',
        fieldErrors: { slug: ['A drama with this slug already exists.'] },
      },
    };
  }

  const [row] = await db
    .insert(dramas)
    .values({
      title: parsed.title,
      slug: parsed.slug,
      description: parsed.description,
      status: parsed.status,
      structure_type: parsed.structure_type,
      poster: parsed.poster,
      banner: parsed.banner,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning();

  return { ok: true, drama: toDrama(row) };
}

/** Drama update. */
export async function updateDrama(
  actor: ActorContext,
  dramaId: string,
  input: unknown
): Promise<{ ok: true; drama: ReturnType<typeof toDrama> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), dramaId);
  const parsed = parseOrThrow(createDramaSchema, input);

  // Check for duplicate slug (excluding the current drama)
  const [conflict] = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(
      and(
        eq(dramas.slug, parsed.slug),
        isNull(dramas.deleted_at),
        ne(dramas.id, parsedId)
      )
    );

  if (conflict) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A drama with this slug already exists.',
        fieldErrors: { slug: ['A drama with this slug already exists.'] },
      },
    };
  }

  // Track slug change history if the slug is being changed
  const [oldDrama] = await db
    .select({ slug: dramas.slug })
    .from(dramas)
    .where(eq(dramas.id, parsedId));

  if (oldDrama && oldDrama.slug !== parsed.slug) {
    await db.insert(contentSlugHistory).values({
      content_type: 'drama',
      content_id: parsedId,
      old_slug: oldDrama.slug,
      new_slug: parsed.slug,
    });
  }

  const [row] = await db
    .update(dramas)
    .set({
      title: parsed.title,
      slug: parsed.slug,
      description: parsed.description,
      status: parsed.status,
      structure_type: parsed.structure_type,
      poster: parsed.poster,
      banner: parsed.banner,
      updated_at: new Date(),
    })
    .where(and(eq(dramas.id, parsedId), isNull(dramas.deleted_at)))
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Drama not found.') };
  }

  // Handle categories update (replace all existing categories)
  if (parsed.categories !== undefined && Array.isArray(parsed.categories)) {
    // Remove existing category associations
    await db
      .delete(dramaCategories)
      .where(eq(dramaCategories.drama_id, parsedId));

    // Add new category associations
    if (parsed.categories.length > 0) {
      await db.insert(dramaCategories).values(
        parsed.categories.map((catId) => ({
          drama_id: parsedId,
          category_id: catId,
        }))
      );
    }
  }

  // Handle platforms update (replace all existing platforms)
  if (parsed.platforms !== undefined && Array.isArray(parsed.platforms)) {
    // Remove existing platform associations
    await db
      .delete(dramaPlatforms)
      .where(eq(dramaPlatforms.drama_id, parsedId));

    // Add new platform associations
    if (parsed.platforms.length > 0) {
      await db.insert(dramaPlatforms).values(
        parsed.platforms.map((platId) => ({
          drama_id: parsedId,
          platform_id: platId,
        }))
      );
    }
  }

  return { ok: true, drama: toDrama(row) };
}

/** List non-deleted dramas for administration with pagination and filters. */
export async function listDramas(
  actor: ActorContext,
  query: ListDramasQuery
): Promise<{
  ok: true;
  dramas: ReturnType<typeof toDrama>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
} | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const offset = (query.page - 1) * query.pageSize;

  // Build WHERE conditions
  const whereConditions: any[] = [isNull(dramas.deleted_at)];

  // Status filter
  if (query.status) {
    whereConditions.push(eq(dramas.status, query.status));
  }

  // Search filter (title or slug)
  if (query.search) {
    const searchPattern = `%${query.search}%`;
    whereConditions.push(
      sql`${dramas.title} ILIKE ${searchPattern} OR ${dramas.slug} ILIKE ${searchPattern}`
    );
  }

  // Count total
  const [totalRow] = await db
    .select({ total: count() })
    .from(dramas)
    .where(and(...whereConditions));

  const total = Number(totalRow?.total ?? 0);

  // Build ORDER BY
  const sortColumn = query.sort === 'title' ? dramas.title : query.sort === 'status' ? dramas.status : dramas.created_at;
  const sortOrder = query.order === 'desc' ? desc : asc;
  const orderBy = sortOrder(sortColumn);

  // Fetch dramas with pagination
  const rows = await db
    .select()
    .from(dramas)
    .where(and(...whereConditions))
    .orderBy(orderBy)
    .limit(query.pageSize)
    .offset(offset);

  return {
    ok: true,
    dramas: rows.map(toDrama),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    hasNextPage: query.page < Math.ceil(total / query.pageSize),
    hasPreviousPage: query.page > 1,
  };
}

/** Soft-delete a drama (mark deleted_at). */
export async function deleteDrama(
  actor: ActorContext,
  dramaId: string
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), dramaId);

  const [row] = await db
    .update(dramas)
    .set({ deleted_at: new Date() })
    .where(and(eq(dramas.id, parsedId), isNull(dramas.deleted_at)))
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Drama not found.') };
  }

  return { ok: true };
}

function toDrama(row: typeof dramas.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    status: row.status,
    structure_type: row.structure_type,
    poster: row.poster,
    banner: row.banner,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}