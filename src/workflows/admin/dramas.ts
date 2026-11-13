import 'server-only';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import { dramaStatusSchema } from '@/modules/content/validation';
import { dramas, contentSlugHistory, dramaCategories, dramaPlatforms } from '@/modules/content/schema';
import { parseOrThrow, parseCreateDramaInput, type CreateDramaInput } from '@/modules/content/validation';

/** Permission key for drama management. */
const MANAGE_PERMISSION = 'drama.manage';

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

/** List non-deleted dramas for administration. */
export async function listDramas(
  actor: ActorContext
): Promise<{ ok: true; dramas: ReturnType<typeof toDrama>[]; total: number } | { ok: false; error: unknown }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const [totalRow] = await db
    .select({ total: count() })
    .from(dramas)
    .where(isNull(dramas.deleted_at));

  const total = Number(totalRow?.total ?? 0);

  const rows = await db
    .select()
    .from(dramas)
    .where(isNull(dramas.deleted_at))
    .orderBy(dramas.title);

  return {
    ok: true,
    dramas: rows.map(toDrama),
    total,
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
    poster: row.poster,
    banner: row.banner,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}