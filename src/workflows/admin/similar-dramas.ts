import 'server-only';

import { and, asc, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { similar_dramas as similarDramas, dramas } from '@/modules/content/schema';
import { parseOrThrow } from '@/modules/content/validation';
import { ConflictError, NotFoundError, ValidationError } from '@/platform/errors';

/**
 * Similar-drama administration.
 *
 * Every query joins the target drama, so soft-deleted targets can never leak
 * into a list or a count, and every mutation runs inside a transaction that
 * re-validates the parent. Failures are raised as typed application errors;
 * the routes map them to HTTP statuses and the page maps them to `notFound()`.
 */

/** Permission key for similar drama management. Phase 3 renames it to snake_case. */
const MANAGE_PERMISSION = 'similar_drama.manage';

/** The target's stored position. Existing rows may still carry a null. */
export type SimilarDramaPosition = number | null;

/** One managed recommendation. */
export type SimilarDramaSummary = {
  id: string;
  title: string;
  poster: string | null;
  description: string | null;
  position: SimilarDramaPosition;
};

/** Paginated listing for one parent drama. */
export type SimilarDramaListResult = {
  items: SimilarDramaSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

const listSimilarDramasQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['position', 'title', 'createdAt']).default('position'),
  order: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().trim().max(200).optional(),
});

export type SimilarDramaListQuery = z.infer<typeof listSimilarDramasQuerySchema>;

/** Parse a listing query, throwing a REST-safe validation error on failure. */
export function parseListSimilarDramasQuery(input: unknown): SimilarDramaListQuery {
  return parseOrThrow(listSimilarDramasQuerySchema, input);
}

const SIMILAR_DRAMA_SORT_FIELDS = new Set<string>(['position', 'title', 'createdAt']);

/** Build the sort token used by the admin table kit (`-column` = descending). */
export function formatSimilarDramaSortToken(
  sort: SimilarDramaListQuery['sort'],
  order: SimilarDramaListQuery['order']
): string {
  return order === 'desc' ? `-${sort}` : sort;
}

/**
 * Parse the admin table query contract (`page`, `pageSize`, `sort`, `q`).
 *
 * Invalid values fall back to the defaults instead of erroring, matching the
 * other admin tables: a stale or hand-edited URL still renders.
 */
export function parseSimilarDramaTableQuery(input: unknown): SimilarDramaListQuery {
  const schema = z
    .object({
      page: z.coerce.number().int().min(1).catch(1),
      pageSize: z.coerce.number().int().min(1).max(100).catch(20),
      sort: z.string().trim().max(32).catch('position'),
      q: z.string().trim().max(200).catch(''),
    })
    .transform(value => {
      let sort: SimilarDramaListQuery['sort'] = 'position';
      let order: SimilarDramaListQuery['order'] = 'asc';

      for (const segment of value.sort.split(',')) {
        const trimmed = segment.trim();
        if (trimmed.length === 0) continue;

        const descending = trimmed.startsWith('-');
        const column = descending ? trimmed.slice(1) : trimmed;

        if (SIMILAR_DRAMA_SORT_FIELDS.has(column)) {
          sort = column as SimilarDramaListQuery['sort'];
          order = descending ? 'desc' : 'asc';
          break;
        }
      }

      return {
        page: value.page,
        pageSize: value.pageSize,
        sort,
        order,
        search: value.q.length > 0 ? value.q : undefined,
      };
    });

  return schema.parse(input);
}

const positionSchema = z.coerce.number().int().min(0).max(1_000_000);
const searchSchema = z.string().trim().min(1).max(200);
const orderedIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(500)
  .refine(ids => new Set(ids).size === ids.length, 'Duplicate drama ids are not allowed.');

/** Route ids are not request payloads: an unparseable id is a missing drama. */
function parseRouteDramaId(value: string): string {
  const parsed = z.uuid().safeParse(value);

  if (!parsed.success) {
    throw new NotFoundError('Drama not found.');
  }

  return parsed.data;
}

/** Escape LIKE metacharacters so a search term is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/**
 * Load a parent drama that is not in the Trash.
 *
 * `M-09`: a missing parent must be a 404/not-found, never an empty success.
 */
async function requireActiveDrama(
  executor: Pick<typeof db, 'select'>,
  dramaId: string
): Promise<{ id: string; title: string }> {
  const [drama] = await executor
    .select({ id: dramas.id, title: dramas.title })
    .from(dramas)
    .where(and(eq(dramas.id, dramaId), isNull(dramas.deleted_at)));

  if (!drama) {
    throw new NotFoundError('Drama not found.');
  }

  return drama;
}

function scopeConditions(dramaId: string, search?: string) {
  const conditions = [eq(similarDramas.drama_id, dramaId), isNull(dramas.deleted_at)];

  if (search && search.length > 0) {
    conditions.push(ilike(dramas.title, `%${escapeLike(search)}%`));
  }

  return conditions;
}

function orderByColumn(query: SimilarDramaListQuery) {
  if (query.sort === 'title') return dramas.title;
  if (query.sort === 'createdAt') return dramas.created_at;

  return similarDramas.position;
}

/** List recommendations for a drama. Throws `NotFoundError` for a missing parent. */
export async function listSimilarDramas(
  actor: ActorContext,
  dramaId: string,
  query: SimilarDramaListQuery
): Promise<SimilarDramaListResult> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parentId = parseRouteDramaId(dramaId);
  await requireActiveDrama(db, parentId);

  const conditions = scopeConditions(parentId, query.search);

  // Count through the same join as the page query: an unjoined count reported
  // deleted targets and ignored the title search.
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(similarDramas)
    .innerJoin(dramas, eq(similarDramas.similar_drama_id, dramas.id))
    .where(and(...conditions));

  const total = Number(totalRow?.total ?? 0);

  const direction = query.order === 'desc' ? desc : asc;
  const primary =
    query.sort === 'position'
      ? query.order === 'desc'
        ? sql`${similarDramas.position} desc nulls last`
        : sql`${similarDramas.position} asc nulls last`
      : direction(orderByColumn(query));

  const offset = (query.page - 1) * query.pageSize;
  const rows = await db
    .select({
      id: dramas.id,
      title: dramas.title,
      poster: dramas.poster,
      description: dramas.description,
      position: similarDramas.position,
    })
    .from(similarDramas)
    .innerJoin(dramas, eq(similarDramas.similar_drama_id, dramas.id))
    .where(and(...conditions))
    .orderBy(primary, asc(dramas.title), asc(similarDramas.similar_drama_id))
    .limit(query.pageSize)
    .offset(offset);

  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

  return {
    items: rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages,
    hasNextPage: query.page < totalPages,
    hasPreviousPage: query.page > 1,
  };
}

/** Server-page load: the parent's title plus the filtered list in one call. */
export async function loadSimilarDramasPage(
  actor: ActorContext,
  dramaId: string,
  query: SimilarDramaListQuery
): Promise<{ drama: { id: string; title: string }; result: SimilarDramaListResult }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parentId = parseRouteDramaId(dramaId);
  const drama = await requireActiveDrama(db, parentId);
  const result = await listSimilarDramas(actor, parentId, query);

  return { drama, result };
}

/**
 * Add a recommendation.
 *
 * The position defaults to the current maximum plus one, so appending is the
 * natural operation and ordering stays contiguous for new rows.
 */
export async function addSimilarDrama(
  actor: ActorContext,
  dramaId: string,
  similarDramaId: string,
  position?: number
): Promise<SimilarDramaSummary> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parentId = parseRouteDramaId(dramaId);
  const targetId = parseOrThrow(z.uuid(), similarDramaId);
  const requestedPosition =
    position === undefined ? undefined : parseOrThrow(positionSchema, position);

  if (parentId === targetId) {
    throw new ValidationError('A drama cannot be similar to itself.');
  }

  return db.transaction(async tx => {
    await requireActiveDrama(tx, parentId);

    const [target] = await tx
      .select({
        id: dramas.id,
        title: dramas.title,
        poster: dramas.poster,
        description: dramas.description,
      })
      .from(dramas)
      .where(and(eq(dramas.id, targetId), isNull(dramas.deleted_at)));

    if (!target) {
      throw new NotFoundError('Similar drama not found.');
    }

    const [existing] = await tx
      .select({ id: similarDramas.drama_id })
      .from(similarDramas)
      .where(
        and(eq(similarDramas.drama_id, parentId), eq(similarDramas.similar_drama_id, targetId))
      );

    if (existing) {
      throw new ConflictError('This drama is already marked as similar to the selected drama.');
    }

    let nextPosition = requestedPosition;

    if (nextPosition === undefined) {
      const [maxRow] = await tx
        .select({ max: sql<number | null>`max(${similarDramas.position})` })
        .from(similarDramas)
        .where(eq(similarDramas.drama_id, parentId));

      nextPosition = Number(maxRow?.max ?? -1) + 1;
    }

    await tx.insert(similarDramas).values({
      drama_id: parentId,
      similar_drama_id: targetId,
      position: nextPosition,
    });

    return { ...target, position: nextPosition };
  });
}

/** Remove a recommendation. */
export async function removeSimilarDrama(
  actor: ActorContext,
  dramaId: string,
  similarDramaId: string
): Promise<void> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parentId = parseRouteDramaId(dramaId);
  const targetId = parseOrThrow(z.uuid(), similarDramaId);

  const removed = await db
    .delete(similarDramas)
    .where(and(eq(similarDramas.drama_id, parentId), eq(similarDramas.similar_drama_id, targetId)))
    .returning({ id: similarDramas.similar_drama_id });

  if (removed.length === 0) {
    throw new NotFoundError('Similar drama association not found.');
  }
}

/** Set one recommendation's position. */
export async function updateSimilarDramaPosition(
  actor: ActorContext,
  dramaId: string,
  similarDramaId: string,
  position: number
): Promise<SimilarDramaSummary> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parentId = parseRouteDramaId(dramaId);
  const targetId = parseOrThrow(z.uuid(), similarDramaId);
  const parsedPosition = parseOrThrow(positionSchema, position);

  return db.transaction(async tx => {
    const updated = await tx
      .update(similarDramas)
      .set({ position: parsedPosition })
      .where(
        and(eq(similarDramas.drama_id, parentId), eq(similarDramas.similar_drama_id, targetId))
      )
      .returning({ id: similarDramas.similar_drama_id });

    if (updated.length === 0) {
      throw new NotFoundError('Similar drama association not found.');
    }

    const [target] = await tx
      .select({
        id: dramas.id,
        title: dramas.title,
        poster: dramas.poster,
        description: dramas.description,
      })
      .from(dramas)
      .where(eq(dramas.id, targetId));

    if (!target) {
      throw new NotFoundError('Similar drama not found.');
    }

    return { ...target, position: parsedPosition };
  });
}

/**
 * Replace the order of a drama's recommendations in one transaction.
 *
 * The caller must submit every currently associated target exactly once;
 * anything else is rejected before a single position is written.
 */
export async function reorderSimilarDramas(
  actor: ActorContext,
  dramaId: string,
  orderedIds: readonly string[]
): Promise<SimilarDramaSummary[]> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parentId = parseRouteDramaId(dramaId);
  const parsedIds = parseOrThrow(orderedIdsSchema, [...orderedIds]);

  return db.transaction(async tx => {
    await requireActiveDrama(tx, parentId);

    const rows = await tx
      .select({
        id: dramas.id,
        title: dramas.title,
        poster: dramas.poster,
        description: dramas.description,
        position: similarDramas.position,
      })
      .from(similarDramas)
      .innerJoin(dramas, eq(similarDramas.similar_drama_id, dramas.id))
      .where(and(eq(similarDramas.drama_id, parentId), isNull(dramas.deleted_at)));

    const byId = new Map(rows.map(row => [row.id, row]));

    if (parsedIds.length !== byId.size || parsedIds.some(id => !byId.has(id))) {
      throw new ValidationError(
        'The order must contain every currently associated drama exactly once.'
      );
    }

    const ordered: SimilarDramaSummary[] = [];

    for (const [index, id] of parsedIds.entries()) {
      await tx
        .update(similarDramas)
        .set({ position: index })
        .where(and(eq(similarDramas.drama_id, parentId), eq(similarDramas.similar_drama_id, id)));

      const row = byId.get(id);

      if (!row) {
        throw new ValidationError('The order must contain only associated dramas.');
      }

      ordered.push({ ...row, position: index });
    }

    return ordered;
  });
}

/**
 * Search active dramas that can still be added to a parent's recommendations.
 *
 * Excludes the parent itself, Trash entries, and targets already associated.
 */
export async function searchSimilarDramaCandidates(
  actor: ActorContext,
  dramaId: string,
  search: string
): Promise<SimilarDramaSummary[]> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parentId = parseRouteDramaId(dramaId);
  const term = parseOrThrow(searchSchema, search);
  await requireActiveDrama(db, parentId);

  const rows = await db
    .select({
      id: dramas.id,
      title: dramas.title,
      poster: dramas.poster,
      description: dramas.description,
    })
    .from(dramas)
    .where(
      and(
        isNull(dramas.deleted_at),
        ilike(dramas.title, `%${escapeLike(term)}%`),
        sql`${dramas.id} <> ${parentId}`,
        sql`not exists (select 1 from ${similarDramas} where ${similarDramas.drama_id} = ${parentId} and ${similarDramas.similar_drama_id} = ${dramas.id})`
      )
    )
    .orderBy(asc(dramas.title))
    .limit(20);

  return rows.map(row => ({ ...row, position: null }));
}

/**
 * Load the currently associated ids in their stored order.
 *
 * Exposed for callers that need a compact snapshot (for example a client that
 * reorders without re-reading the table).
 */
export async function listSimilarDramaIds(actor: ActorContext, dramaId: string): Promise<string[]> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parentId = parseRouteDramaId(dramaId);
  await requireActiveDrama(db, parentId);

  const rows = await db
    .select({ id: similarDramas.similar_drama_id })
    .from(similarDramas)
    .innerJoin(dramas, eq(similarDramas.similar_drama_id, dramas.id))
    .where(and(...scopeConditions(parentId)))
    .orderBy(
      sql`${similarDramas.position} asc nulls last`,
      asc(dramas.title),
      asc(similarDramas.similar_drama_id)
    );

  return rows.map(row => row.id);
}
