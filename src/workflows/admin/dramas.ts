import 'server-only';

import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import {
  categories,
  content_slug_history as contentSlugHistory,
  drama_categories as dramaCategories,
  drama_platforms as dramaPlatforms,
  dramas,
  episodes,
  platforms,
  seasons,
} from '@/modules/content/schema';
import type { DramaTaxonomyOption } from '@/lib/contracts/drama-form';
import { createDramaSchema, parseOrThrow, updateDramaSchema } from '@/modules/content/validation';

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

/**
 * Active categories and platforms that a drama may be associated with.
 *
 * Reads the live taxonomy rows for the create form's checkbox groups. Trashed
 * rows are excluded so the form can never offer a target that `createDrama`
 * would reject. Ordered by curated position, then name, for a stable list.
 */
export async function listDramaTaxonomy(actor: ActorContext): Promise<{
  categories: DramaTaxonomyOption[];
  platforms: DramaTaxonomyOption[];
}> {
  requirePermission(actor, MANAGE_PERMISSION);

  const [categoryRows, platformRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(isNull(categories.deleted_at))
      .orderBy(asc(categories.position), asc(categories.name)),
    db
      .select({ id: platforms.id, name: platforms.name })
      .from(platforms)
      .where(isNull(platforms.deleted_at))
      .orderBy(asc(platforms.position), asc(platforms.name)),
  ]);

  return { categories: categoryRows, platforms: platformRows };
}

/** Drama create. */
export async function createDrama(
  actor: ActorContext,
  input: unknown
): Promise<{ ok: true; drama: ReturnType<typeof toDrama> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsed = parseOrThrow(createDramaSchema, input);

  return db.transaction(async tx => {
    // Check for duplicate slug
    const [existing] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(and(eq(dramas.slug, parsed.slug), isNull(dramas.deleted_at)));

    if (existing) {
      return {
        ok: false as const,
        error: {
          code: 'validation_error',
          message: 'A drama with this slug already exists.',
          fieldErrors: { slug: ['A drama with this slug already exists.'] },
        },
      };
    }

    // Resolve and validate every association target before writing anything, so
    // an invalid id stores no drama at all (H-04).
    const categoryIds = await resolveAssociationTargets(
      tx,
      parsed.categories ?? [],
      categories,
      'categories'
    );

    if (!categoryIds.ok) {
      return { ok: false as const, error: categoryIds.error };
    }

    const platformIds = await resolveAssociationTargets(
      tx,
      parsed.platforms ?? [],
      platforms,
      'platforms'
    );

    if (!platformIds.ok) {
      return { ok: false as const, error: platformIds.error };
    }

    const [row] = await tx
      .insert(dramas)
      .values({
        title: parsed.title,
        slug: parsed.slug,
        description: parsed.description,
        status: parsed.status,
        structure_type: parsed.structure_type,
        visibility: parsed.visibility,
        poster: parsed.poster,
        banner: parsed.banner,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    if (!row) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    if (categoryIds.ids.length > 0) {
      await tx.insert(dramaCategories).values(
        categoryIds.ids.map(categoryId => ({
          drama_id: row.id,
          category_id: categoryId,
        }))
      );
    }

    if (platformIds.ids.length > 0) {
      await tx.insert(dramaPlatforms).values(
        platformIds.ids.map(platformId => ({
          drama_id: row.id,
          platform_id: platformId,
        }))
      );
    }

    return { ok: true as const, drama: toDrama(row) };
  });
}

/** Drama update. */
export async function updateDrama(
  actor: ActorContext,
  dramaId: string,
  input: unknown
): Promise<{ ok: true; drama: ReturnType<typeof toDrama> } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), dramaId);
  const parsed = parseOrThrow(updateDramaSchema, input);

  return db.transaction(async tx => {
    // Read and lock the current row. The lock is held until commit, so two
    // simultaneous replacements of the same drama's associations serialize
    // instead of interleaving into a mixed set. The slug history needs the old
    // slug, and the structure type may only be repeated, never changed (D-029).
    const [oldDrama] = await tx
      .select({
        slug: dramas.slug,
        structureType: dramas.structure_type,
        deletedAt: dramas.deleted_at,
      })
      .from(dramas)
      .where(eq(dramas.id, parsedId))
      .for('no key update')
      .limit(1);

    if (!oldDrama || oldDrama.deletedAt !== null) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    // The admin form never sends a slug; an omitted value keeps the stored one.
    const nextSlug = parsed.slug ?? oldDrama.slug;

    // Check for duplicate slug (excluding the current drama)
    const [conflict] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(and(eq(dramas.slug, nextSlug), isNull(dramas.deleted_at), ne(dramas.id, parsedId)));

    if (conflict) {
      return {
        ok: false as const,
        error: {
          code: 'validation_error',
          message: 'A drama with this slug already exists.',
          fieldErrors: { slug: ['A drama with this slug already exists.'] },
        },
      };
    }

    if (parsed.structure_type !== undefined && parsed.structure_type !== oldDrama.structureType) {
      return {
        ok: false as const,
        error: {
          code: 'conflict',
          message:
            'The drama structure cannot be changed here. Use the structure conversion endpoint.',
        },
      };
    }

    // Validate every supplied association target before any write, so a bad id
    // leaves the previous set untouched.
    const categoryIds =
      parsed.categories === undefined
        ? null
        : await resolveAssociationTargets(tx, parsed.categories, categories, 'categories');

    if (categoryIds !== null && !categoryIds.ok) {
      return { ok: false as const, error: categoryIds.error };
    }

    const platformIds =
      parsed.platforms === undefined
        ? null
        : await resolveAssociationTargets(tx, parsed.platforms, platforms, 'platforms');

    if (platformIds !== null && !platformIds.ok) {
      return { ok: false as const, error: platformIds.error };
    }

    if (oldDrama.slug !== nextSlug) {
      await tx.insert(contentSlugHistory).values({
        content_type: 'drama',
        content_id: parsedId,
        old_slug: oldDrama.slug,
        new_slug: nextSlug,
      });
    }

    const [row] = await tx
      .update(dramas)
      .set({
        title: parsed.title,
        slug: nextSlug,
        description: parsed.description ?? null,
        status: parsed.status,
        poster: parsed.poster,
        banner: parsed.banner,
        visibility: parsed.visibility,
        updated_at: new Date(),
      })
      .where(and(eq(dramas.id, parsedId), isNull(dramas.deleted_at)))
      .returning();

    if (!row) {
      return { ok: false as const, error: new NotFoundError('Drama not found.') };
    }

    // Replace the whole set inside the same transaction: a request never
    // observes a half-replaced association set.
    if (categoryIds !== null && categoryIds.ok) {
      await tx.delete(dramaCategories).where(eq(dramaCategories.drama_id, parsedId));

      if (categoryIds.ids.length > 0) {
        await tx.insert(dramaCategories).values(
          categoryIds.ids.map(categoryId => ({
            drama_id: parsedId,
            category_id: categoryId,
          }))
        );
      }
    }

    if (platformIds !== null && platformIds.ok) {
      await tx.delete(dramaPlatforms).where(eq(dramaPlatforms.drama_id, parsedId));

      if (platformIds.ids.length > 0) {
        await tx.insert(dramaPlatforms).values(
          platformIds.ids.map(platformId => ({
            drama_id: parsedId,
            platform_id: platformId,
          }))
        );
      }
    }

    return { ok: true as const, drama: toDrama(row) };
  });
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type AssociationResolution =
  | { ok: true; ids: string[] }
  | {
      ok: false;
      error: { code: 'validation_error'; message: string; fieldErrors: Record<string, string[]> };
    };

/**
 * Deduplicate association ids and prove every target exists and is active.
 *
 * The join tables carry a composite primary key, so a repeated id in the input
 * used to fail the insert with a raw `23505` instead of a field error. A target
 * that is missing or in the Trash is rejected: associating it would make the
 * trashed taxonomy reappear in public listings.
 */
async function resolveAssociationTargets(
  tx: DbTransaction,
  ids: readonly string[],
  table: typeof categories | typeof platforms,
  field: 'categories' | 'platforms'
): Promise<AssociationResolution> {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return { ok: true, ids: [] };
  }

  const rows = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.id, unique), isNull(table.deleted_at)));

  const found = new Set(rows.map(row => row.id));
  const missing = unique.filter(id => !found.has(id));

  if (missing.length > 0) {
    const message =
      field === 'categories'
        ? 'One or more categories do not exist or are in the Trash.'
        : 'One or more platforms do not exist or are in the Trash.';

    return {
      ok: false,
      error: {
        code: 'validation_error',
        message,
        fieldErrors: { [field]: [message] },
      },
    };
  }

  return { ok: true, ids: unique };
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
}> {
  requirePermission(actor, MANAGE_PERMISSION);

  const offset = (query.page - 1) * query.pageSize;

  // Build WHERE conditions: default is non-deleted; `trashed` selects the
  // soft-deleted view; draft/published/unpublished filter the publication state.
  const whereConditions: any[] = [];

  if (query.status === 'trashed') {
    whereConditions.push(isNotNull(dramas.deleted_at));
  } else {
    whereConditions.push(isNull(dramas.deleted_at));

    // Status filter operates on the canonical publication vocabulary.
    if (query.status) {
      whereConditions.push(eq(dramas.publication_status, query.status));
    }
  }

  // Search filter (title or slug).
  //
  // The alternatives are grouped in their own `or(...)`. A bare `OR` inside
  // `and(...)` is re-associated by SQL precedence (`AND` binds tighter), so the
  // last alternative escapes the parent, publication, and deleted predicates
  // and can return a trashed or unpublished drama (M-01).
  if (query.search) {
    const searchPattern = `%${query.search}%`;
    whereConditions.push(
      or(ilike(dramas.title, searchPattern), ilike(dramas.slug, searchPattern))!
    );
  }

  // Count total
  const [totalRow] = await db
    .select({ total: count() })
    .from(dramas)
    .where(and(...whereConditions));

  const total = Number(totalRow?.total ?? 0);

  // Build ORDER BY. The id tiebreaker makes the order total: without it rows
  // that share a sort value have no defined relative order, so a paged read can
  // repeat one row and skip another between requests (M-08).
  const sortColumn =
    query.sort === 'title'
      ? dramas.title
      : query.sort === 'status'
        ? dramas.publication_status
        : dramas.created_at;
  const sortOrder = query.order === 'desc' ? desc : asc;
  const orderBy = [sortOrder(sortColumn), sortOrder(dramas.id)];

  // Fetch dramas with pagination
  const rows = await db
    .select()
    .from(dramas)
    .where(and(...whereConditions))
    .orderBy(...orderBy)
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

/** Soft-delete a drama (mark deleted_at). Moving a drama to Trash preserves
 * its hierarchy and relationships for restoration. Shows affected child
 * records (seasons, episodes) before the operation.
 *
 * The cascade is transactional and uses one timestamp for the drama and every
 * child it trashes. That shared timestamp is what makes the restore exact:
 * restoring the drama restores precisely the children that were trashed with
 * it, and leaves children that were already in the Trash untouched.
 */
export async function deleteDrama(
  actor: ActorContext,
  dramaId: string
): Promise<
  | { ok: true; affectedSeasons: number; affectedEpisodes: number }
  | { ok: false; error: unknown; affectedSeasons: number; affectedEpisodes: number }
> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), dramaId);

  return db.transaction(async tx => {
    const [row] = await tx
      .select({ id: dramas.id })
      .from(dramas)
      .where(and(eq(dramas.id, parsedId), isNull(dramas.deleted_at)))
      .for('no key update')
      .limit(1);

    if (!row) {
      return {
        ok: false as const,
        error: new NotFoundError('Drama not found.'),
        affectedSeasons: 0,
        affectedEpisodes: 0,
      };
    }

    const now = new Date();

    // Trash and count in one statement: the reported count is exactly the set
    // that changed, and rows that were already in the trash keep their own
    // original deletion time.
    const trashedEpisodes = await tx
      .update(episodes)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(episodes.drama_id, parsedId), isNull(episodes.deleted_at)))
      .returning({ id: episodes.id });

    const trashedSeasons = await tx
      .update(seasons)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(seasons.drama_id, parsedId), isNull(seasons.deleted_at)))
      .returning({ id: seasons.id });

    await tx
      .update(dramas)
      .set({ deleted_at: now, updated_at: now })
      .where(eq(dramas.id, parsedId));

    return {
      ok: true as const,
      affectedSeasons: trashedSeasons.length,
      affectedEpisodes: trashedEpisodes.length,
    };
  });
}

/** Admin detail for a single drama. */
export type AdminDramaDetail = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: string | null;
  structure_type: string;
  visibility: string | null;
  poster: string | null;
  banner: string | null;
  categoryIds: string[];
  platformIds: string[];
  activeSeasons: number;
  activeEpisodes: number;
  createdAt: string;
};

/**
 * Load one drama for the admin detail page, including its category/platform
 * names and active content counts.
 */
export async function getDramaForAdmin(
  actor: ActorContext,
  dramaId: string
): Promise<{ drama: AdminDramaDetail; categoryNames: string[]; platformNames: string[] } | null> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), dramaId);

  const [dramaRow] = await db
    .select()
    .from(dramas)
    .where(and(eq(dramas.id, parsedId), isNull(dramas.deleted_at)))
    .limit(1);

  if (!dramaRow) {
    return null;
  }

  const [seasonCount, episodeCount, categoryRows, platformRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(seasons)
      .where(and(eq(seasons.drama_id, parsedId), isNull(seasons.deleted_at))),
    db
      .select({ total: count() })
      .from(episodes)
      .where(and(eq(episodes.drama_id, parsedId), isNull(episodes.deleted_at))),
    db
      .select({ id: categories.id, name: categories.name })
      .from(dramaCategories)
      .innerJoin(categories, eq(dramaCategories.category_id, categories.id))
      .where(and(eq(dramaCategories.drama_id, parsedId), isNull(categories.deleted_at)))
      .orderBy(categories.name),
    db
      .select({ id: platforms.id, name: platforms.name })
      .from(dramaPlatforms)
      .innerJoin(platforms, eq(dramaPlatforms.platform_id, platforms.id))
      .where(and(eq(dramaPlatforms.drama_id, parsedId), isNull(platforms.deleted_at)))
      .orderBy(platforms.name),
  ]);

  return {
    drama: {
      id: dramaRow.id,
      title: dramaRow.title,
      slug: dramaRow.slug,
      description: dramaRow.description,
      status: dramaRow.status,
      structure_type: dramaRow.structure_type,
      visibility: dramaRow.visibility,
      poster: dramaRow.poster,
      banner: dramaRow.banner,
      categoryIds: categoryRows.map(row => row.id),
      platformIds: platformRows.map(row => row.id),
      activeSeasons: Number(seasonCount[0]?.total ?? 0),
      activeEpisodes: Number(episodeCount[0]?.total ?? 0),
      createdAt: dramaRow.created_at.toISOString(),
    },
    categoryNames: categoryRows.map(row => row.name),
    platformNames: platformRows.map(row => row.name),
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
