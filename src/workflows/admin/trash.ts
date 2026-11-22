import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { hasPermission, type ActorContext, type PermissionKey } from '@/modules/authorization';
import {
  TRASH_CONTENT_TYPES,
  type TrashContentType,
  type TrashItem,
  type TrashListResult,
} from '@/lib/contracts/trash';
import { AuthorizationError } from '@/platform/errors';
import { parseOrThrow } from '@/modules/content/validation';
import { serverConfig } from '@/platform/config';

/**
 * Content Trash read model.
 *
 * The Trash is a cross-content-type view: an administrator sees every trashed
 * drama, season, episode, and movie in one place, with the date the content
 * entered the Trash and the date it will be permanently removed by the
 * expiry maintenance command.
 *
 * The listing is read-only. Moving content to Trash, restoring it, and
 * permanently deleting it live in the workflows that own those operations.
 */

/** The content types that support Trash. */
export { TRASH_CONTENT_TYPES };
export type { TrashContentType, TrashItem, TrashListResult };

/** Manage permission for each Trash content type. */
export const TRASH_MANAGE_PERMISSIONS: Record<TrashContentType, PermissionKey> = {
  drama: 'drama.manage',
  season: 'season.manage',
  episode: 'episode.manage',
  movie: 'movie.manage',
};

const trashListQuerySchema = z.object({
  type: z.enum(['all', ...TRASH_CONTENT_TYPES]).catch('all'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
  search: z.string().trim().max(200).catch(''),
});

export type TrashListQuery = z.infer<typeof trashListQuerySchema>;

/** Parse the Trash query, tolerating stale or hand-edited values. */
export function parseTrashListQuery(input: unknown): TrashListQuery {
  return trashListQuerySchema.parse(input);
}

/** Milliseconds in one day, used to project the expiry date. */
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function expiryDate(deletedAt: Date): string {
  return new Date(deletedAt.getTime() + serverConfig.trashRetentionDays * DAY_IN_MS).toISOString();
}

/** The content types the actor is allowed to see and manage. */
export function permittedTrashTypes(actor: ActorContext): TrashContentType[] {
  return TRASH_CONTENT_TYPES.filter(type => hasPermission(actor, TRASH_MANAGE_PERMISSIONS[type]));
}

type RawTrashRow = {
  id: string;
  title: string;
  parentTitle: string | null;
  deletedAtMs: string;
  contentType: TrashContentType;
  seasons: number;
  episodes: number;
};

function toTrashItem(row: RawTrashRow): TrashItem {
  const deletedAt = new Date(Number(row.deletedAtMs));

  return {
    id: row.id,
    contentType: row.contentType,
    title: row.title,
    parentTitle: row.parentTitle,
    deletedAt: deletedAt.toISOString(),
    expiresAt: expiryDate(deletedAt),
    childCounts: {
      seasons: row.seasons,
      episodes: row.episodes,
    },
  };
}

/**
 * One branch of the merged Trash query per content type.
 *
 * The branches are static SQL: the table names and the projected columns are
 * fixed by the schema, and the only untrusted values (the search term, the
 * page size, and the offset) are passed as query parameters. The branches are
 * merged with `UNION ALL` so the merged list is paged in the database, instead
 * of loading every trashed row of every type into the process.
 *
 * The Trash date is projected as epoch milliseconds rather than as a
 * timestamp: a raw query has no column metadata, so the driver would hand the
 * timestamp back as an unparsed string.
 */
const TRASH_BRANCH_SQL: Record<TrashContentType, string> = {
  drama: `select d.id::text as id, d.title, null::text as parent_title,
                 ((extract(epoch from d.deleted_at) * 1000)::bigint) as deleted_at_ms,
                 'drama'::text as content_type,
                 (select count(*)::int from seasons s
                    where s.drama_id = d.id and s.deleted_at is not null) as seasons,
                 (select count(*)::int from episodes e
                    where e.drama_id = d.id and e.deleted_at is not null) as episodes
            from dramas d
           where d.deleted_at is not null`,
  season: `select s.id::text as id, s.title, d.title as parent_title,
                 ((extract(epoch from s.deleted_at) * 1000)::bigint) as deleted_at_ms,
                 'season'::text as content_type,
                 0 as seasons,
                 (select count(*)::int from episodes e
                    where e.season_id = s.id and e.deleted_at is not null) as episodes
            from seasons s
            join dramas d on d.id = s.drama_id
           where s.deleted_at is not null`,
  episode: `select e.id::text as id, e.title, d.title as parent_title,
                 ((extract(epoch from e.deleted_at) * 1000)::bigint) as deleted_at_ms,
                 'episode'::text as content_type,
                 0 as seasons,
                 0 as episodes
            from episodes e
            join dramas d on d.id = e.drama_id
           where e.deleted_at is not null`,
  movie: `select m.id::text as id, m.title, null::text as parent_title,
                 ((extract(epoch from m.deleted_at) * 1000)::bigint) as deleted_at_ms,
                 'movie'::text as content_type,
                 0 as seasons,
                 0 as episodes
            from movies m
           where m.deleted_at is not null`,
};

/** Build the merged query for the content types the actor may manage. */
function mergedTrashQuery(types: readonly TrashContentType[]): ReturnType<typeof sql.join> {
  return sql.join(
    types.map(type => sql.raw(TRASH_BRANCH_SQL[type])),
    sql` union all `
  );
}

/** Escape LIKE metacharacters so a search term is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/**
 * The search term as a SQL pattern, or `null` when every title matches.
 *
 * The term is escaped, so a literal `%` in the search box searches for a
 * literal percent sign instead of matching every row.
 */
function searchPattern(search: string): string | null {
  const trimmed = search.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return `%${escapeLikePattern(trimmed)}%`;
}

/**
 * List trashed content.
 *
 * `type: 'all'` merges the four content types. The merge is ordered by the
 * Trash date, so the administrator sees the most recently trashed content
 * first regardless of which type it is, and the page is applied by the
 * database: only the rows of the requested window are ever loaded.
 */
export async function listTrashItems(
  actor: ActorContext,
  query: TrashListQuery
): Promise<TrashListResult> {
  const permitted = permittedTrashTypes(actor);

  if (permitted.length === 0) {
    throw new AuthorizationError('The actor may not manage any trashed content.');
  }

  const requested = query.type === 'all' ? permitted : [query.type as TrashContentType];
  const types = requested.filter(type => permitted.includes(type));

  if (types.length === 0) {
    throw new AuthorizationError('The actor may not manage this content type.');
  }

  const offset = (query.page - 1) * query.pageSize;
  const merged = mergedTrashQuery(types);
  const pattern = searchPattern(query.search);
  const searchCondition =
    pattern === null ? sql`` : sql`where title ilike ${pattern} escape '\\'`;

  const rowsResult = await db.execute(sql`
    select id,
           title,
           parent_title as "parentTitle",
           deleted_at_ms as "deletedAtMs",
           content_type as "contentType",
           seasons,
           episodes
      from (${merged}) as trash
      ${searchCondition}
     order by deleted_at_ms desc, id asc
     limit ${query.pageSize}
     offset ${offset}
  `);

  const totalResult = await db.execute(sql`
    select count(*)::int as total
      from (${merged}) as trash
      ${searchCondition}
  `);

  const total = Number((totalResult.rows[0] as { total?: number } | undefined)?.total ?? 0);
  const items = (rowsResult.rows as unknown as RawTrashRow[]).map(row => toTrashItem(row));
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages,
    hasNextPage: query.page < totalPages,
    hasPreviousPage: query.page > 1,
    retentionDays: serverConfig.trashRetentionDays,
  };
}

/**
 * The child records a permanent deletion would remove.
 *
 * The Trash UI shows this before asking for confirmation, so an administrator
 * always sees the consequences of an irreversible operation.
 */
export type TrashImpact = {
  contentType: TrashContentType;
  id: string;
  title: string;
  seasons: number;
  episodes: number;
  bookmarks: number;
  playbackProgress: number;
  watchHistory: number;
  ratings: number;
  reviews: number;
  analyticsEvents: number;
};

/** Parse the Trash content type from an untrusted request value. */
export function parseTrashContentType(value: unknown): TrashContentType {
  return parseOrThrow(z.enum(TRASH_CONTENT_TYPES), value);
}
