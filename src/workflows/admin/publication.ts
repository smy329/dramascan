import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext, type PermissionKey } from '@/modules/authorization';
import { z } from 'zod';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import {
  evaluatePublicationEligibility,
  evaluatePublicAvailability,
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
