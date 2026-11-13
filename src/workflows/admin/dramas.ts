import 'server-only';

import { and, eq, isNull, ne, count } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import { z } from 'zod';
import { dramaStatusSchema } from '@/modules/content/validation';
import { dramas } from '@/modules/content/schema';
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

  const [row] = await db
    .update(dramas)
    .set({
      title: parsed.title,
      slug: parsed.slug,
      description: parsed.description,
      status: parsed.status,
      updated_at: new Date(),
    })
    .where(and(eq(dramas.id, parsedId), isNull(dramas.deleted_at)))
    .returning();

  if (!row) {
    return { ok: false, error: new NotFoundError('Drama not found.') };
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
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}