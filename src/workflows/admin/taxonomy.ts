import 'server-only';

import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { slugFromText } from '@/lib/contracts/slug';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import {
  categories,
  drama_categories as dramaCategories,
  drama_platforms as dramaPlatforms,
  movie_categories as movieCategories,
  movie_platforms as moviePlatforms,
  platforms,
} from '@/modules/content/schema';
import {
  createCategorySchema,
  createPlatformSchema,
  parseOrThrow,
  updateCategorySchema,
  updatePlatformSchema,
} from '@/modules/content/validation';
import { isUniqueViolation } from '@/platform/db/pg-errors';
import { NotFoundError, ValidationError } from '@/platform/errors';

/**
 * Category and platform administration.
 *
 * Categories and platforms are soft-deletable taxonomy rows. The administrator
 * supplies a name only: the slug is derived here with the shared `slugFromText`
 * rule, never accepted from the client. Names must stay unique among active
 * rows (case-insensitive) and so must their slugs, because the database only
 * constrains the slug. Every entry point re-checks its canonical permission;
 * the pages and Server Actions gate separately.
 *
 * Deletes mark `deleted_at` and keep association rows, so a trashed category
 * still explains which dramas or movies used it. Reusing a trashed row's name
 * is allowed: both uniqueness checks ignore trashed rows, matching the partial
 * unique index on the slug column.
 */

const CATEGORY_MANAGE_PERMISSION = 'category.manage';
const PLATFORM_MANAGE_PERMISSION = 'platform.manage';

/** Serializable taxonomy row returned to the admin screens. */
export type TaxonomyRow = {
  id: string;
  name: string;
  slug: string;
  position: number | null;
  visibility: string | null;
  usageCount: number;
  createdAt: string;
};

type TaxonomyMutationResult<T> = { ok: true } & T;

/** Error for a name that cannot produce a URL slug. */
function emptySlugError(): ValidationError {
  const message = 'Name must contain at least one Latin letter or number.';
  return new ValidationError(message, { name: [message] });
}

/** Error for a name that is already taken by an active row. */
function duplicateNameError(label: 'category' | 'platform'): ValidationError {
  const message = `A ${label} with this name already exists.`;
  return new ValidationError(message, { name: [message] });
}

/** Error for two different names that derive the same slug. */
function duplicateSlugError(label: 'category' | 'platform'): ValidationError {
  const message = `A ${label} with a name that produces this URL slug already exists. Choose a different name.`;
  return new ValidationError(message, { name: [message] });
}

function toCategoryRow(
  row: typeof categories.$inferSelect,
  usageCount: number
): TaxonomyRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    position: row.position,
    visibility: row.visibility,
    usageCount,
    createdAt: row.created_at.toISOString(),
  };
}

function toPlatformRow(row: typeof platforms.$inferSelect, usageCount: number): TaxonomyRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    position: row.position,
    visibility: null,
    usageCount,
    createdAt: row.created_at.toISOString(),
  };
}

/** List active categories with their association counts, in curated order. */
export async function listCategories(actor: ActorContext): Promise<{ categories: TaxonomyRow[] }> {
  requirePermission(actor, CATEGORY_MANAGE_PERMISSION);

  const [rows, dramaUsage, movieUsage] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(isNull(categories.deleted_at))
      .orderBy(sql`${categories.position} asc nulls last`, asc(categories.name)),
    db
      .select({ categoryId: dramaCategories.category_id, total: count() })
      .from(dramaCategories)
      .groupBy(dramaCategories.category_id),
    db
      .select({ categoryId: movieCategories.category_id, total: count() })
      .from(movieCategories)
      .groupBy(movieCategories.category_id),
  ]);

  const usage = new Map<string, number>();
  for (const row of [...dramaUsage, ...movieUsage]) {
    usage.set(row.categoryId, (usage.get(row.categoryId) ?? 0) + Number(row.total));
  }

  return {
    categories: rows.map(row => toCategoryRow(row, usage.get(row.id) ?? 0)),
  };
}

/** Create a category. */
export async function createCategory(
  actor: ActorContext,
  input: unknown
): Promise<TaxonomyMutationResult<{ category: TaxonomyRow }> | { ok: false; error: unknown }> {
  requirePermission(actor, CATEGORY_MANAGE_PERMISSION);

  const parsed = parseOrThrow(createCategorySchema, input);
  const slug = slugFromText(parsed.name);

  if (slug.length === 0) {
    return { ok: false, error: emptySlugError() };
  }

  try {
    return await db.transaction(async tx => {
      const [nameConflict] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(isNull(categories.deleted_at), sql`lower(${categories.name}) = lower(${parsed.name})`))
        .limit(1);

      if (nameConflict) {
        return { ok: false as const, error: duplicateNameError('category') };
      }

      const [slugConflict] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.slug, slug), isNull(categories.deleted_at)))
        .limit(1);

      if (slugConflict) {
        return { ok: false as const, error: duplicateSlugError('category') };
      }

      const [positionRow] = await tx
        .select({ max: sql<number | null>`max(${categories.position})` })
        .from(categories)
        .where(isNull(categories.deleted_at));

      const nextPosition =
        positionRow?.max === null || positionRow?.max === undefined
          ? 0
          : Number(positionRow.max) + 1;

      const [row] = await tx
        .insert(categories)
        .values({
          name: parsed.name,
          slug,
          visibility: parsed.visibility,
          position: nextPosition,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      if (!row) {
        return { ok: false as const, error: new NotFoundError('Category not found.') };
      }

      return { ok: true as const, category: toCategoryRow(row, 0) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: duplicateSlugError('category') };
    }

    throw error;
  }
}

/** Update a category; the slug is re-derived whenever the name changes. */
export async function updateCategory(
  actor: ActorContext,
  categoryId: string,
  input: unknown
): Promise<TaxonomyMutationResult<{ category: TaxonomyRow }> | { ok: false; error: unknown }> {
  requirePermission(actor, CATEGORY_MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), categoryId);
  const parsed = parseOrThrow(updateCategorySchema, input);
  const nextSlug = parsed.name === undefined ? undefined : slugFromText(parsed.name);

  if (nextSlug !== undefined && nextSlug.length === 0) {
    return { ok: false, error: emptySlugError() };
  }

  try {
    return await db.transaction(async tx => {
      const [current] = await tx
        .select({ id: categories.id, deletedAt: categories.deleted_at })
        .from(categories)
        .where(eq(categories.id, parsedId))
        .for('no key update')
        .limit(1);

      if (!current || current.deletedAt !== null) {
        return { ok: false as const, error: new NotFoundError('Category not found.') };
      }

      if (parsed.name !== undefined) {
        const [nameConflict] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              isNull(categories.deleted_at),
              ne(categories.id, parsedId),
              sql`lower(${categories.name}) = lower(${parsed.name})`
            )
          )
          .limit(1);

        if (nameConflict) {
          return { ok: false as const, error: duplicateNameError('category') };
        }

        const [slugConflict] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.slug, nextSlug!),
              isNull(categories.deleted_at),
              ne(categories.id, parsedId)
            )
          )
          .limit(1);

        if (slugConflict) {
          return { ok: false as const, error: duplicateSlugError('category') };
        }
      }

      const patch: {
        name?: string;
        slug?: string;
        visibility?: 'visible' | 'hidden';
        updated_at: Date;
      } = { updated_at: new Date() };

      if (parsed.name !== undefined) {
        patch.name = parsed.name;
        patch.slug = nextSlug!;
      }

      if (parsed.visibility !== undefined) {
        patch.visibility = parsed.visibility;
      }

      const [row] = await tx
        .update(categories)
        .set(patch)
        .where(and(eq(categories.id, parsedId), isNull(categories.deleted_at)))
        .returning();

      if (!row) {
        return { ok: false as const, error: new NotFoundError('Category not found.') };
      }

      const usageCount = await countCategoryUsage(tx, parsedId);

      return { ok: true as const, category: toCategoryRow(row, usageCount) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: duplicateSlugError('category') };
    }

    throw error;
  }
}

/** Soft-delete a category and report how many associations it still has. */
export async function deleteCategory(
  actor: ActorContext,
  categoryId: string
): Promise<TaxonomyMutationResult<{ usageCount: number }> | { ok: false; error: unknown }> {
  requirePermission(actor, CATEGORY_MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), categoryId);

  return db.transaction(async tx => {
    const [row] = await tx
      .update(categories)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(and(eq(categories.id, parsedId), isNull(categories.deleted_at)))
      .returning({ id: categories.id });

    if (!row) {
      return { ok: false as const, error: new NotFoundError('Category not found.') };
    }

    const usageCount = await countCategoryUsage(tx, parsedId);

    return { ok: true as const, usageCount };
  });
}

/** Write the given display order as positions 0..n-1. */
export async function reorderCategories(
  actor: ActorContext,
  ids: string[]
): Promise<TaxonomyMutationResult<{ reordered: number }> | { ok: false; error: unknown }> {
  requirePermission(actor, CATEGORY_MANAGE_PERMISSION);

  const parsedIds = parseOrThrow(z.array(z.uuid()).min(1), ids);

  if (new Set(parsedIds).size !== parsedIds.length) {
    const message = 'The reorder request contains duplicate ids.';
    return { ok: false, error: new ValidationError(message, { ids: [message] }) };
  }

  return db.transaction(async tx => {
    const rows = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(inArray(categories.id, parsedIds), isNull(categories.deleted_at)))
      .orderBy(asc(categories.id))
      .for('update');

    if (rows.length !== parsedIds.length) {
      const message = 'One or more categories do not exist or are in the Trash.';
      return { ok: false as const, error: new ValidationError(message, { ids: [message] }) };
    }

    for (const [index, id] of parsedIds.entries()) {
      await tx
        .update(categories)
        .set({ position: index, updated_at: new Date() })
        .where(eq(categories.id, id));
    }

    return { ok: true as const, reordered: parsedIds.length };
  });
}

/** List active platforms with their association counts, in curated order. */
export async function listPlatforms(actor: ActorContext): Promise<{ platforms: TaxonomyRow[] }> {
  requirePermission(actor, PLATFORM_MANAGE_PERMISSION);

  const [rows, dramaUsage, movieUsage] = await Promise.all([
    db
      .select()
      .from(platforms)
      .where(isNull(platforms.deleted_at))
      .orderBy(sql`${platforms.position} asc nulls last`, asc(platforms.name)),
    db
      .select({ platformId: dramaPlatforms.platform_id, total: count() })
      .from(dramaPlatforms)
      .groupBy(dramaPlatforms.platform_id),
    db
      .select({ platformId: moviePlatforms.platform_id, total: count() })
      .from(moviePlatforms)
      .groupBy(moviePlatforms.platform_id),
  ]);

  const usage = new Map<string, number>();
  for (const row of [...dramaUsage, ...movieUsage]) {
    usage.set(row.platformId, (usage.get(row.platformId) ?? 0) + Number(row.total));
  }

  return {
    platforms: rows.map(row => toPlatformRow(row, usage.get(row.id) ?? 0)),
  };
}

/** Create a platform. */
export async function createPlatform(
  actor: ActorContext,
  input: unknown
): Promise<TaxonomyMutationResult<{ platform: TaxonomyRow }> | { ok: false; error: unknown }> {
  requirePermission(actor, PLATFORM_MANAGE_PERMISSION);

  const parsed = parseOrThrow(createPlatformSchema, input);
  const slug = slugFromText(parsed.name);

  if (slug.length === 0) {
    return { ok: false, error: emptySlugError() };
  }

  try {
    return await db.transaction(async tx => {
      const [nameConflict] = await tx
        .select({ id: platforms.id })
        .from(platforms)
        .where(
          and(isNull(platforms.deleted_at), sql`lower(${platforms.name}) = lower(${parsed.name})`)
        )
        .limit(1);

      if (nameConflict) {
        return { ok: false as const, error: duplicateNameError('platform') };
      }

      const [slugConflict] = await tx
        .select({ id: platforms.id })
        .from(platforms)
        .where(and(eq(platforms.slug, slug), isNull(platforms.deleted_at)))
        .limit(1);

      if (slugConflict) {
        return { ok: false as const, error: duplicateSlugError('platform') };
      }

      const [positionRow] = await tx
        .select({ max: sql<number | null>`max(${platforms.position})` })
        .from(platforms)
        .where(isNull(platforms.deleted_at));

      const nextPosition =
        positionRow?.max === null || positionRow?.max === undefined
          ? 0
          : Number(positionRow.max) + 1;

      const [row] = await tx
        .insert(platforms)
        .values({
          name: parsed.name,
          slug,
          position: nextPosition,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      if (!row) {
        return { ok: false as const, error: new NotFoundError('Platform not found.') };
      }

      return { ok: true as const, platform: toPlatformRow(row, 0) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: duplicateSlugError('platform') };
    }

    throw error;
  }
}

/** Update a platform; the slug is re-derived whenever the name changes. */
export async function updatePlatform(
  actor: ActorContext,
  platformId: string,
  input: unknown
): Promise<TaxonomyMutationResult<{ platform: TaxonomyRow }> | { ok: false; error: unknown }> {
  requirePermission(actor, PLATFORM_MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), platformId);
  const parsed = parseOrThrow(updatePlatformSchema, input);
  const nextSlug = parsed.name === undefined ? undefined : slugFromText(parsed.name);

  if (nextSlug !== undefined && nextSlug.length === 0) {
    return { ok: false, error: emptySlugError() };
  }

  try {
    return await db.transaction(async tx => {
      const [current] = await tx
        .select({ id: platforms.id, deletedAt: platforms.deleted_at })
        .from(platforms)
        .where(eq(platforms.id, parsedId))
        .for('no key update')
        .limit(1);

      if (!current || current.deletedAt !== null) {
        return { ok: false as const, error: new NotFoundError('Platform not found.') };
      }

      if (parsed.name !== undefined) {
        const [nameConflict] = await tx
          .select({ id: platforms.id })
          .from(platforms)
          .where(
            and(
              isNull(platforms.deleted_at),
              ne(platforms.id, parsedId),
              sql`lower(${platforms.name}) = lower(${parsed.name})`
            )
          )
          .limit(1);

        if (nameConflict) {
          return { ok: false as const, error: duplicateNameError('platform') };
        }

        const [slugConflict] = await tx
          .select({ id: platforms.id })
          .from(platforms)
          .where(
            and(
              eq(platforms.slug, nextSlug!),
              isNull(platforms.deleted_at),
              ne(platforms.id, parsedId)
            )
          )
          .limit(1);

        if (slugConflict) {
          return { ok: false as const, error: duplicateSlugError('platform') };
        }
      }

      const patch: { name?: string; slug?: string; updated_at: Date } = {
        updated_at: new Date(),
      };

      if (parsed.name !== undefined) {
        patch.name = parsed.name;
        patch.slug = nextSlug!;
      }

      const [row] = await tx
        .update(platforms)
        .set(patch)
        .where(and(eq(platforms.id, parsedId), isNull(platforms.deleted_at)))
        .returning();

      if (!row) {
        return { ok: false as const, error: new NotFoundError('Platform not found.') };
      }

      const usageCount = await countPlatformUsage(tx, parsedId);

      return { ok: true as const, platform: toPlatformRow(row, usageCount) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: duplicateSlugError('platform') };
    }

    throw error;
  }
}

/** Soft-delete a platform and report how many associations it still has. */
export async function deletePlatform(
  actor: ActorContext,
  platformId: string
): Promise<TaxonomyMutationResult<{ usageCount: number }> | { ok: false; error: unknown }> {
  requirePermission(actor, PLATFORM_MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), platformId);

  return db.transaction(async tx => {
    const [row] = await tx
      .update(platforms)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(and(eq(platforms.id, parsedId), isNull(platforms.deleted_at)))
      .returning({ id: platforms.id });

    if (!row) {
      return { ok: false as const, error: new NotFoundError('Platform not found.') };
    }

    const usageCount = await countPlatformUsage(tx, parsedId);

    return { ok: true as const, usageCount };
  });
}

/** Write the given display order as positions 0..n-1. */
export async function reorderPlatforms(
  actor: ActorContext,
  ids: string[]
): Promise<TaxonomyMutationResult<{ reordered: number }> | { ok: false; error: unknown }> {
  requirePermission(actor, PLATFORM_MANAGE_PERMISSION);

  const parsedIds = parseOrThrow(z.array(z.uuid()).min(1), ids);

  if (new Set(parsedIds).size !== parsedIds.length) {
    const message = 'The reorder request contains duplicate ids.';
    return { ok: false, error: new ValidationError(message, { ids: [message] }) };
  }

  return db.transaction(async tx => {
    const rows = await tx
      .select({ id: platforms.id })
      .from(platforms)
      .where(and(inArray(platforms.id, parsedIds), isNull(platforms.deleted_at)))
      .orderBy(asc(platforms.id))
      .for('update');

    if (rows.length !== parsedIds.length) {
      const message = 'One or more platforms do not exist or are in the Trash.';
      return { ok: false as const, error: new ValidationError(message, { ids: [message] }) };
    }

    for (const [index, id] of parsedIds.entries()) {
      await tx
        .update(platforms)
        .set({ position: index, updated_at: new Date() })
        .where(eq(platforms.id, id));
    }

    return { ok: true as const, reordered: parsedIds.length };
  });
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function countCategoryUsage(tx: DbTransaction, categoryId: string): Promise<number> {
  const dramaRows = await tx
    .select({ total: count() })
    .from(dramaCategories)
    .where(eq(dramaCategories.category_id, categoryId));
  const movieRows = await tx
    .select({ total: count() })
    .from(movieCategories)
    .where(eq(movieCategories.category_id, categoryId));

  return Number(dramaRows[0]?.total ?? 0) + Number(movieRows[0]?.total ?? 0);
}

async function countPlatformUsage(tx: DbTransaction, platformId: string): Promise<number> {
  const dramaRows = await tx
    .select({ total: count() })
    .from(dramaPlatforms)
    .where(eq(dramaPlatforms.platform_id, platformId));
  const movieRows = await tx
    .select({ total: count() })
    .from(moviePlatforms)
    .where(eq(moviePlatforms.platform_id, platformId));

  return Number(dramaRows[0]?.total ?? 0) + Number(movieRows[0]?.total ?? 0);
}
