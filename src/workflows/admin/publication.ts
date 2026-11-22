import 'server-only';

import { and, asc, count, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext, type PermissionKey } from '@/modules/authorization';
import { z } from 'zod';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import {
  evaluatePublicationEligibility,
  evaluatePublicAvailability,
  normalizePublicationStatus,
  type AvailabilityParent,
  type PublicationContentType,
  type PublicationStatus,
} from '@/modules/content/publication';
import { parsePublicationRequest } from '@/modules/content/validation';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type PublicationAction = 'publish' | 'unpublish';

type PublicationItemStatus = 'succeeded' | 'skipped' | 'failed';

type PublicationItemReason =
  | 'invalid_id'
  | 'not_found'
  | 'trashed'
  | 'already_published'
  | 'already_unpublished'
  | 'missing_source'
  | 'invalid_source'
  | 'duplicate_id'
  | 'update_failed';

type PublicationItemResult = {
  id: string;
  status: PublicationItemStatus;
  reason: PublicationItemReason | null;
  message?: string;
  publicationStatus?: PublicationStatus;
  publiclyAvailable?: boolean;
};

type PublicationSummary = {
  requested: number;
  succeeded: number;
  skipped: number;
  failed: number;
};

type PublicationResult = {
  contentType: PublicationContentType;
  action: PublicationAction;
  summary: PublicationSummary;
  results: PublicationItemResult[];
};

/** Permission key for each content type (reuse the resource manage permission). */
const MANAGE_PERMISSIONS: Record<PublicationContentType, PermissionKey> = {
  drama: 'drama.manage',
  season: 'season.manage',
  episode: 'episode.manage',
  movie: 'movie.manage',
};

/** Bounded batch size for bulk publication operations. */
const PUBLICATION_BATCH_SIZE = 100;

type PublicationRow = {
  id: string;
  publication_status: string;
  published_at: Date | null;
  deleted_at: Date | null;
  video_source: string | null;
  season_id: string | null;
  drama_id: string | null;
};

/**
 * Fetch content rows for a batch inside a transaction, locking them row by row.
 */
async function fetchById(
  contentType: PublicationContentType,
  tx: Tx,
  ids: string[]
): Promise<Map<string, PublicationRow>> {
  const byId = new Map<string, PublicationRow>();
  const targetIds = Array.from(new Set(ids)).filter(id => z.uuid().safeParse(id).success);

  if (contentType === 'drama') {
    const rows = await tx.select().from(dramas).where(inArray(dramas.id, targetIds)).for('update');

    for (const row of rows) {
      byId.set(row.id, {
        id: row.id,
        publication_status: row.publication_status,
        published_at: row.published_at,
        deleted_at: row.deleted_at,
        video_source: null,
        season_id: null,
        drama_id: null,
      });
    }
  } else if (contentType === 'season') {
    const rows = await tx
      .select()
      .from(seasons)
      .where(inArray(seasons.id, targetIds))
      .for('update');

    for (const row of rows) {
      byId.set(row.id, {
        id: row.id,
        publication_status: row.publication_status,
        published_at: row.published_at,
        deleted_at: row.deleted_at,
        video_source: null,
        season_id: null,
        drama_id: row.drama_id,
      });
    }
  } else if (contentType === 'episode') {
    const rows = await tx
      .select()
      .from(episodes)
      .where(inArray(episodes.id, targetIds))
      .for('update');

    for (const row of rows) {
      byId.set(row.id, {
        id: row.id,
        publication_status: row.publication_status,
        published_at: row.published_at,
        deleted_at: row.deleted_at,
        video_source: row.video_source,
        season_id: row.season_id,
        drama_id: row.drama_id,
      });
    }
  } else {
    const rows = await tx.select().from(movies).where(inArray(movies.id, targetIds)).for('update');

    for (const row of rows) {
      byId.set(row.id, {
        id: row.id,
        publication_status: row.publication_status,
        published_at: row.published_at,
        deleted_at: row.deleted_at,
        video_source: row.video_source,
        season_id: null,
        drama_id: null,
      });
    }
  }

  return byId;
}

/**
 * Compute effective public availability for one item, including ancestors.
 */
async function resolveAvailability(
  contentType: PublicationContentType,
  tx: Tx,
  row: PublicationRow,
  publicationStatus: PublicationStatus
): Promise<boolean> {
  const deleted = row.deleted_at !== null;

  let parentDrama: AvailabilityParent | null = null;
  let parentSeason: AvailabilityParent | null = null;

  if (contentType === 'season') {
    const [drama] = await tx
      .select()
      .from(dramas)
      .where(eq(dramas.id, row.drama_id ?? ''));

    parentDrama = drama
      ? {
          publicationStatus: (drama.publication_status as PublicationStatus) ?? 'draft',
          deleted: drama.deleted_at !== null,
        }
      : { publicationStatus: 'draft', deleted: false };
  }

  if (contentType === 'episode') {
    const [drama] = await tx
      .select()
      .from(dramas)
      .where(eq(dramas.id, row.drama_id ?? ''));
    const [season] = row.season_id
      ? await tx.select().from(seasons).where(eq(seasons.id, row.season_id))
      : [null];

    parentDrama = drama
      ? {
          publicationStatus: (drama.publication_status as PublicationStatus) ?? 'draft',
          deleted: drama.deleted_at !== null,
        }
      : { publicationStatus: 'draft', deleted: false };

    parentSeason = season
      ? {
          publicationStatus: (season.publication_status as PublicationStatus) ?? 'draft',
          deleted: season.deleted_at !== null,
        }
      : null;
  }

  const availability = evaluatePublicAvailability({
    contentType,
    publicationStatus,
    deleted,
    parentDrama,
    parentSeason,
  });

  return availability.publiclyAvailable;
}

/**
 * Apply a single publication operation to a batch of content items.
 *
 * Eligibility is decided per item (source readiness, already-published state,
 * trashed state). Ineligible items are skipped and reported; only eligible
 * items are updated. Each batch runs in a transaction that locks its rows, so
 * concurrent publish/unpublish operations serialize per content item.
 */
export async function updatePublication(
  actor: ActorContext,
  input: unknown
): Promise<PublicationResult> {
  const parsed = parsePublicationRequest(input);

  requirePermission(actor, MANAGE_PERMISSIONS[parsed.contentType]);

  const results: PublicationItemResult[] = [];
  const seenIds = new Set<string>();

  for (let start = 0; start < parsed.ids.length; start += PUBLICATION_BATCH_SIZE) {
    const batch = parsed.ids.slice(start, start + PUBLICATION_BATCH_SIZE);
    const batchResults: PublicationItemResult[] = [];

    try {
      await db.transaction(async tx => {
        const byId = await fetchById(parsed.contentType, tx, batch);

        for (const id of batch) {
          const uuid = z.uuid().safeParse(id);

          if (!uuid.success) {
            batchResults.push({
              id,
              status: 'failed',
              reason: 'invalid_id',
              message: 'Id must be a UUID.',
            });
            continue;
          }

          if (seenIds.has(uuid.data)) {
            batchResults.push({
              id,
              status: 'skipped',
              reason: 'duplicate_id',
              message: 'Duplicate id ignored.',
            });
            continue;
          }

          seenIds.add(uuid.data);
          const row = byId.get(uuid.data);

          if (!row) {
            batchResults.push({
              id,
              status: 'skipped',
              reason: 'not_found',
              message: 'Content not found.',
            });
            continue;
          }

          if (row.deleted_at !== null) {
            batchResults.push({
              id,
              status: 'skipped',
              reason: 'trashed',
              message: 'Content is in Trash.',
            });
            continue;
          }

          const currentStatus = row.publication_status as PublicationStatus;
          const eligibility = evaluatePublicationEligibility({
            contentType: parsed.contentType,
            action: parsed.action,
            publicationStatus: currentStatus,
            videoSource: row.video_source,
          });

          if (!eligibility.eligible) {
            batchResults.push({
              id,
              status: 'skipped',
              reason: eligibility.reason as PublicationItemReason,
              message: eligibility.message,
              publicationStatus: currentStatus,
            });
            continue;
          }
          const targetStatus = parsed.action === 'publish' ? 'published' : 'unpublished';
          const table =
            parsed.contentType === 'drama'
              ? dramas
              : parsed.contentType === 'season'
                ? seasons
                : parsed.contentType === 'episode'
                  ? episodes
                  : movies;
          const now = new Date();

          // `published_at` records the first successful publication (SCOPE-D01).
          // It is written once and never rewritten: an ordinary edit, an
          // unpublish, and a later republication all preserve the original
          // instant, so the value stays a stable "first published" date.
          const [updated] =
            parsed.action === 'publish'
              ? await tx
                  .update(table)
                  .set({
                    publication_status: targetStatus,
                    published_at: row.published_at ?? now,
                    updated_at: now,
                  })
                  .where(and(eq(table.id, row.id), eq(table.publication_status, currentStatus)))
                  .returning()
              : await tx
                  .update(table)
                  .set({ publication_status: targetStatus, updated_at: now })
                  .where(and(eq(table.id, row.id), eq(table.publication_status, currentStatus)))
                  .returning();

          const publicationStatus =
            (updated?.publication_status as PublicationStatus) ?? targetStatus;
          const publiclyAvailable = await resolveAvailability(
            parsed.contentType,
            tx,
            { ...row, publication_status: publicationStatus },
            publicationStatus
          );

          batchResults.push({
            id,
            status: 'succeeded',
            reason: null,
            publicationStatus,
            publiclyAvailable,
          });
        }
      });

      results.push(...batchResults);
    } catch {
      for (const id of batch) {
        results.push({
          id,
          status: 'failed',
          reason: 'update_failed',
          message: 'Publication update failed.',
        });
      }
    }
  }

  const succeeded = results.filter(result => result.status === 'succeeded').length;
  const skipped = results.filter(result => result.status === 'skipped').length;
  const failed = results.filter(result => result.status === 'failed').length;

  return {
    contentType: parsed.contentType,
    action: parsed.action,
    summary: {
      requested: results.length,
      succeeded,
      skipped,
      failed,
    },
    results,
  };
}

/** Manual publish of content. */
export async function publishContent(
  actor: ActorContext,
  input: unknown
): Promise<PublicationResult> {
  return updatePublication(actor, { ...(input as object), action: 'publish' });
}

/** Manual unpublish of content. */
export async function unpublishContent(
  actor: ActorContext,
  input: unknown
): Promise<PublicationResult> {
  return updatePublication(actor, { ...(input as object), action: 'unpublish' });
}

// ----- publication workbench read model -------------------------------------

const publicationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
  search: z.string().trim().max(200).catch(''),
});

export type PublicationListQuery = z.infer<typeof publicationListQuerySchema>;

export type PublicationListItem = {
  id: string;
  title: string;
  publicationStatus: PublicationStatus;
  publishedAt: string | null;
  hasVideoSource: boolean;
  eligibleToPublish: boolean;
  eligibleToUnpublish: boolean;
};

export type PublicationListResult = {
  items: PublicationListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

/** Parse the publication workbench query, tolerating stale values. */
export function parsePublicationListQuery(input: unknown): PublicationListQuery {
  return publicationListQuerySchema.parse(input);
}

function toPublicationItem(row: {
  id: string;
  title: string;
  publication_status: string;
  published_at: Date | null;
  video_source: string | null;
}, contentType: PublicationContentType): PublicationListItem {
  const publicationStatus = normalizePublicationStatus(row.publication_status);
  const publish = evaluatePublicationEligibility({
    contentType,
    action: 'publish',
    publicationStatus,
    videoSource: row.video_source,
  });
  const unpublish = evaluatePublicationEligibility({
    contentType,
    action: 'unpublish',
    publicationStatus,
    videoSource: row.video_source,
  });

  return {
    id: row.id,
    title: row.title,
    publicationStatus,
    publishedAt: row.published_at?.toISOString() ?? null,
    hasVideoSource: row.video_source !== null && row.video_source.trim() !== '',
    eligibleToPublish: publish.eligible,
    eligibleToUnpublish: unpublish.eligible,
  };
}

/**
 * List active content for the publication workbench.
 *
 * Only the item's own readiness is reported. Publishing a parent never
 * publishes its children: the child rows remain draft until they are selected
 * and pass their own eligibility checks.
 */
export async function listPublicationItems(
  actor: ActorContext,
  contentType: PublicationContentType,
  query: PublicationListQuery
): Promise<PublicationListResult> {
  requirePermission(actor, MANAGE_PERMISSIONS[contentType]);

  const searchPattern = `%${query.search}%`;
  const offset = (query.page - 1) * query.pageSize;

  if (contentType === 'drama') {
    const where = and(
      isNull(dramas.deleted_at),
      query.search.length > 0 ? ilike(dramas.title, searchPattern) : undefined
    );
    const [[totalRow], rows] = await Promise.all([
      db.select({ total: count() }).from(dramas).where(where),
      db
        .select({
          id: dramas.id,
          title: dramas.title,
          publication_status: dramas.publication_status,
          published_at: dramas.published_at,
          video_source: sql<string | null>`null`,
        })
        .from(dramas)
        .where(where)
        .orderBy(asc(dramas.title), asc(dramas.id))
        .limit(query.pageSize)
        .offset(offset),
    ]);

    return toListResult(rows.map(row => toPublicationItem(row, 'drama')), Number(totalRow?.total ?? 0), query);
  }

  if (contentType === 'season') {
    const where = and(
      isNull(seasons.deleted_at),
      query.search.length > 0 ? ilike(seasons.title, searchPattern) : undefined
    );
    const [[totalRow], rows] = await Promise.all([
      db.select({ total: count() }).from(seasons).where(where),
      db
        .select({
          id: seasons.id,
          title: seasons.title,
          publication_status: seasons.publication_status,
          published_at: seasons.published_at,
          video_source: sql<string | null>`null`,
        })
        .from(seasons)
        .where(where)
        .orderBy(asc(seasons.title), asc(seasons.id))
        .limit(query.pageSize)
        .offset(offset),
    ]);

    return toListResult(rows.map(row => toPublicationItem(row, 'season')), Number(totalRow?.total ?? 0), query);
  }

  if (contentType === 'episode') {
    const where = and(
      isNull(episodes.deleted_at),
      query.search.length > 0 ? ilike(episodes.title, searchPattern) : undefined
    );
    const [[totalRow], rows] = await Promise.all([
      db.select({ total: count() }).from(episodes).where(where),
      db
        .select({
          id: episodes.id,
          title: episodes.title,
          publication_status: episodes.publication_status,
          published_at: episodes.published_at,
          video_source: episodes.video_source,
        })
        .from(episodes)
        .where(where)
        .orderBy(asc(episodes.title), asc(episodes.id))
        .limit(query.pageSize)
        .offset(offset),
    ]);

    return toListResult(rows.map(row => toPublicationItem(row, 'episode')), Number(totalRow?.total ?? 0), query);
  }

  const where = and(
    isNull(movies.deleted_at),
    query.search.length > 0 ? ilike(movies.title, searchPattern) : undefined
  );
  const [[totalRow], rows] = await Promise.all([
    db.select({ total: count() }).from(movies).where(where),
    db
      .select({
        id: movies.id,
        title: movies.title,
        publication_status: movies.publication_status,
        published_at: movies.published_at,
        video_source: movies.video_source,
      })
      .from(movies)
      .where(where)
      .orderBy(asc(movies.title), asc(movies.id))
      .limit(query.pageSize)
      .offset(offset),
  ]);

  return toListResult(rows.map(row => toPublicationItem(row, 'movie')), Number(totalRow?.total ?? 0), query);
}

function toListResult(
  items: PublicationListItem[],
  total: number,
  query: PublicationListQuery
): PublicationListResult {
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages,
    hasNextPage: query.page < totalPages,
    hasPreviousPage: query.page > 1,
  };
}
