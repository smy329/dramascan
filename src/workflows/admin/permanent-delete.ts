import 'server-only';

import { and, count, eq, inArray, isNotNull, or } from 'drizzle-orm';

import { z } from 'zod';

import { db } from '@/db/client';
import { requireSuperAdmin, type ActorContext } from '@/modules/authorization';
import {
  drama_categories as dramaCategories,
  drama_platforms as dramaPlatforms,
  movies,
  movie_categories as movieCategories,
  movie_platforms as moviePlatforms,
  similar_dramas as similarDramas,
  dramas,
  seasons,
  episodes,
  content_assets as contentAssets,
  content_seo as contentSeo,
  content_slug_history as contentSlugHistory,
  structureConversionSnapshots as conversionSnapshots,
} from '@/modules/content/schema';
import { parseOrThrow } from '@/modules/content/validation';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/platform/errors';
import { createRequestLogger } from '@/platform/logging';

import {
  anonymizeContentReferences,
  countContentReferences as countReviewReferences,
} from '@/modules/reviews/content-ownership';
import {
  countPurgeImpact as countAnalyticsImpact,
  purgeContentReferences as purgeAnalyticsReferences,
} from '@/modules/analytics/content-ownership';
import {
  countPurgeImpact as countNotificationImpact,
  purgeContentReferences as purgeNotificationReferences,
} from '@/modules/notifications/content-ownership';
import {
  countEpisodeImpact,
  countPurgeImpact as countUserImpact,
  purgeContentReferences as purgeUserReferences,
  purgeEpisodeReferences,
} from '@/modules/users/content-ownership';

import {
  TRASH_CONTENT_TYPES,
  type PermanentDeleteBulkResult,
  type PermanentDeleteImpact,
  type PermanentDeleteItemResult,
  type PermanentDeleteRequest,
  type TrashContentType,
} from '@/lib/contracts/trash';

/**
 * Permanent deletion.
 *
 * Permanent deletion is the only irreversible operation in the content model,
 * so it is Super Admin only, it refuses to run on content that is not in the
 * Trash, and it reports exactly what it removed.
 *
 * The cleanup rules follow the approved data-retention policy:
 *
 *   - Bookmarks, playback progress, watched state, and watch history are
 *     removed. They are personal records of content that no longer exists.
 *   - Ratings and reviews are **retained** for aggregate analytics, but the
 *     author identity and the content target are removed, so the row no longer
 *     identifies a person or a piece of content.
 *   - Analytics events and daily aggregates for the content are removed.
 *   - Notifications, slug history, SEO rows, and asset rows for the content are
 *     removed.
 *
 * Everything happens in one transaction: either the content is fully removed
 * with its dependencies, or nothing changes.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Workflow-scoped logger for failures that are not safe to report verbatim. */
const logger = createRequestLogger({ module: 'content' }).logger;

/** The records a permanent deletion affects, reported before and after. */
export type { PermanentDeleteImpact };

/** One item of a bulk permanent deletion. */
export type { PermanentDeleteRequest };

export type { PermanentDeleteItemResult };

export type { PermanentDeleteBulkResult };

const permanentDeleteRequestSchema = z.object({
  contentType: z.enum(TRASH_CONTENT_TYPES),
  id: z.uuid(),
});

/** Parse and validate one permanent-delete request. */
export function parsePermanentDeleteRequest(input: unknown): PermanentDeleteRequest {
  return parseOrThrow(permanentDeleteRequestSchema, input);
}

/** Parse and validate a bulk permanent-delete request. */
export function parsePermanentDeleteBulkRequest(input: unknown): PermanentDeleteRequest[] {
  return parseOrThrow(z.array(permanentDeleteRequestSchema).min(1).max(100), input);
}

/** The content scope a deletion covers. */
type DeletionScope = {
  dramaIds: string[];
  seasonIds: string[];
  episodeIds: string[];
  movieIds: string[];
  /** Content type used by the polymorphic metadata tables. */
  metadataType: 'drama' | 'season' | 'episode' | 'movie';
};

/**
 * Resolve everything the deletion covers.
 *
 * A drama takes its whole hierarchy with it; a season takes its episodes; an
 * episode takes only itself; a movie is independent. The scope is computed
 * before any write so the impact can be shown to the administrator first.
 */
async function resolveScope(
  tx: Tx,
  contentType: TrashContentType,
  id: string
): Promise<DeletionScope> {
  if (contentType === 'drama') {
    // The queries run one after the other: a transaction uses a single
    // PostgreSQL connection, and the driver does not accept two queries on the
    // same connection at the same time.
    const seasonRows = await tx
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.drama_id, id));
    const episodeRows = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.drama_id, id));

    return {
      dramaIds: [id],
      seasonIds: seasonRows.map(row => row.id),
      episodeIds: episodeRows.map(row => row.id),
      movieIds: [],
      metadataType: 'drama',
    };
  }

  if (contentType === 'season') {
    const episodeRows = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.season_id, id));

    return {
      dramaIds: [],
      seasonIds: [id],
      episodeIds: episodeRows.map(row => row.id),
      movieIds: [],
      metadataType: 'season',
    };
  }

  if (contentType === 'episode') {
    return {
      dramaIds: [],
      seasonIds: [],
      episodeIds: [id],
      movieIds: [],
      metadataType: 'episode',
    };
  }

  return {
    dramaIds: [],
    seasonIds: [],
    episodeIds: [],
    movieIds: [id],
    metadataType: 'movie',
  };
}

/** The title of the row that is about to be deleted. */
async function readTitle(
  tx: Tx,
  contentType: TrashContentType,
  id: string
): Promise<string | null> {
  if (contentType === 'drama') {
    const [row] = await tx.select({ title: dramas.title }).from(dramas).where(eq(dramas.id, id));
    return row?.title ?? null;
  }

  if (contentType === 'season') {
    const [row] = await tx.select({ title: seasons.title }).from(seasons).where(eq(seasons.id, id));
    return row?.title ?? null;
  }

  if (contentType === 'episode') {
    const [row] = await tx.select({ title: episodes.title }).from(episodes).where(eq(episodes.id, id));
    return row?.title ?? null;
  }

  const [row] = await tx.select({ title: movies.title }).from(movies).where(eq(movies.id, id));
  return row?.title ?? null;
}

/**
 * Check that a movie converted from this drama does not block the deletion.
 *
 * Provenance is permanent (D-030): the movie keeps a foreign key to its source
 * drama, so the source cannot be removed while the movie exists.
 */
async function assertNoProvenanceBlock(tx: Tx, dramaId: string): Promise<void> {
  const [converted] = await tx
    .select({ id: movies.id, title: movies.title })
    .from(movies)
    .where(eq(movies.converted_from_drama_id, dramaId))
    .limit(1);

  if (converted) {
    throw new ConflictError(
      `This drama was converted into the movie "${converted.title}". The source drama cannot be permanently deleted while the movie exists.`
    );
  }
}

/** Count the polymorphic metadata rows that belong to the deleted content. */
async function countMetadataRows(tx: Tx, scope: DeletionScope): Promise<number> {
  const targetId =
    scope.dramaIds[0] ?? scope.seasonIds[0] ?? scope.episodeIds[0] ?? scope.movieIds[0] ?? null;

  if (targetId === null) {
    return 0;
  }

  const [slugRows] = await tx
    .select({ total: count() })
    .from(contentSlugHistory)
    .where(
      and(eq(contentSlugHistory.content_type, scope.metadataType), eq(contentSlugHistory.content_id, targetId))
    );
  const [seoRows] = await tx
    .select({ total: count() })
    .from(contentSeo)
    .where(and(eq(contentSeo.content_type, scope.metadataType), eq(contentSeo.content_id, targetId)));
  const [assetRows] = await tx
    .select({ total: count() })
    .from(contentAssets)
    .where(and(eq(contentAssets.content_type, scope.metadataType), eq(contentAssets.content_id, targetId)));

  return (
    Number(slugRows?.total ?? 0) + Number(seoRows?.total ?? 0) + Number(assetRows?.total ?? 0)
  );
}

/**
 * Compute what a permanent deletion would remove.
 *
 * The Trash surface shows this before asking for confirmation, so an
 * administrator always sees the consequences of an irreversible operation.
 */
export async function previewPermanentDelete(
  actor: ActorContext,
  contentType: TrashContentType,
  id: string
): Promise<PermanentDeleteImpact> {
  requireSuperAdmin(actor);

  const parsedId = parseOrThrow(z.uuid(), id);

  return db.transaction(async tx => {
    const scope = await resolveScope(tx, contentType, parsedId);
    const title = await readTitle(tx, contentType, parsedId);

    const userImpact =
      contentType === 'drama' || contentType === 'movie'
        ? await countUserImpact(tx, contentType, parsedId, scope.episodeIds)
        : await countEpisodeImpact(tx, scope.episodeIds);

    const reviewImpact =
      contentType === 'drama' || contentType === 'movie'
        ? await countReviewReferences(tx, parsedId)
        : { ratings: 0, reviews: 0 };

    const analyticsImpact =
      contentType === 'drama' || contentType === 'movie'
        ? await countAnalyticsImpact(tx, contentType, parsedId)
        : { contentViewEvents: 0, playbackEvents: 0, dailyAggregates: 0 };

    const notificationImpact =
      contentType === 'drama' || contentType === 'movie'
        ? await countNotificationImpact(tx, contentType, parsedId)
        : { notifications: 0, adminNotifications: 0 };

    const metadataRows = await countMetadataRows(tx, scope);

    return {
      contentType,
      id: parsedId,
      title: title ?? 'Unknown title',
      seasons: scope.seasonIds.length,
      episodes: scope.episodeIds.length,
      bookmarks: userImpact.bookmarks,
      playbackProgress: userImpact.playbackProgress,
      watchedState: userImpact.watchedState,
      watchHistory: userImpact.watchHistory,
      ratings: reviewImpact.ratings,
      reviews: reviewImpact.reviews,
      analyticsEvents:
        analyticsImpact.contentViewEvents +
        analyticsImpact.playbackEvents +
        analyticsImpact.dailyAggregates,
      notifications: notificationImpact.notifications + notificationImpact.adminNotifications,
      metadataRows,
    };
  });
}

/**
 * Permanently delete one trashed item.
 *
 * The item must already be in the Trash: permanent deletion is only ever the
 * second step of the Trash lifecycle, never a shortcut for it.
 */
export async function permanentDelete(
  actor: ActorContext,
  contentType: TrashContentType,
  id: string
): Promise<PermanentDeleteImpact> {
  requireSuperAdmin(actor);

  const parsedId = parseOrThrow(z.uuid(), id);

  return db.transaction(async tx => {
    const scope = await resolveScope(tx, contentType, parsedId);
    const title = await readTitle(tx, contentType, parsedId);

    if (title === null) {
      throw new NotFoundError('Content not found.');
    }

    await assertTrashed(tx, contentType, parsedId);

    if (contentType === 'drama') {
      await assertNoProvenanceBlock(tx, parsedId);
    }

    const impact = await collectImpact(tx, contentType, parsedId, scope, title);

    // 1. Personal records of the content are removed.
    if (contentType === 'drama' || contentType === 'movie') {
      await purgeUserReferences(tx, contentType, parsedId, scope.episodeIds);
      await purgeAnalyticsReferences(tx, contentType, parsedId);
      await purgeNotificationReferences(tx, contentType, parsedId);
      // 2. Ratings and reviews are retained, but anonymized and detached.
      await anonymizeContentReferences(tx, contentType, parsedId);
    } else {
      // A season or an episode has no direct user rows of its own; only the
      // rows that point at its episodes are removed.
      await purgeEpisodeReferences(tx, scope.episodeIds);
    }

    // 3. Polymorphic content metadata is removed.
    await purgeContentMetadata(tx, scope);

    // 4. Content-owned join rows are removed.
    await purgeContentRelations(tx, contentType, scope);

    // 5. The hierarchy is removed from the leaves up, so no foreign key is
    //    left pointing at a row that no longer exists. The `deleted_at` guard
    //    keeps the delete from touching a row that was restored after the
    //    scope was resolved.
    if (scope.episodeIds.length > 0) {
      await tx
        .delete(episodes)
        .where(and(inArray(episodes.id, scope.episodeIds), isNotNull(episodes.deleted_at)));
    }

    if (scope.seasonIds.length > 0) {
      await tx
        .delete(seasons)
        .where(and(inArray(seasons.id, scope.seasonIds), isNotNull(seasons.deleted_at)));
    }

    if (scope.dramaIds.length > 0) {
      await tx
        .delete(dramas)
        .where(and(inArray(dramas.id, scope.dramaIds), isNotNull(dramas.deleted_at)));
    }

    if (scope.movieIds.length > 0) {
      await tx
        .delete(movies)
        .where(and(inArray(movies.id, scope.movieIds), isNotNull(movies.deleted_at)));
    }

    return impact;
  });
}

/** Verify that the row is in the Trash before deleting it for good. */
async function assertTrashed(tx: Tx, contentType: TrashContentType, id: string): Promise<void> {
  // The row is locked for the rest of the transaction, so a restoration that
  // runs at the same time cannot clear `deleted_at` between this check and the
  // delete that follows it.
  if (contentType === 'drama') {
    const [row] = await tx
      .select({ deletedAt: dramas.deleted_at })
      .from(dramas)
      .where(eq(dramas.id, id))
      .for('update')
      .limit(1);
    if (!row) throw new NotFoundError('Drama not found.');
    if (row.deletedAt === null) {
      throw new ValidationError('This drama is not in the Trash. Only trashed content may be permanently deleted.');
    }
    return;
  }

  if (contentType === 'season') {
    const [row] = await tx
      .select({ deletedAt: seasons.deleted_at })
      .from(seasons)
      .where(eq(seasons.id, id))
      .for('update')
      .limit(1);
    if (!row) throw new NotFoundError('Season not found.');
    if (row.deletedAt === null) {
      throw new ValidationError('This season is not in the Trash. Only trashed content may be permanently deleted.');
    }
    return;
  }

  if (contentType === 'episode') {
    const [row] = await tx
      .select({ deletedAt: episodes.deleted_at })
      .from(episodes)
      .where(eq(episodes.id, id))
      .for('update')
      .limit(1);
    if (!row) throw new NotFoundError('Episode not found.');
    if (row.deletedAt === null) {
      throw new ValidationError('This episode is not in the Trash. Only trashed content may be permanently deleted.');
    }
    return;
  }

  const [row] = await tx
    .select({ deletedAt: movies.deleted_at })
    .from(movies)
    .where(eq(movies.id, id))
    .for('update')
    .limit(1);
  if (!row) throw new NotFoundError('Movie not found.');
  if (row.deletedAt === null) {
    throw new ValidationError('This movie is not in the Trash. Only trashed content may be permanently deleted.');
  }
}

/** Count everything the deletion removes, before it removes it. */
async function collectImpact(
  tx: Tx,
  contentType: TrashContentType,
  id: string,
  scope: DeletionScope,
  title: string
): Promise<PermanentDeleteImpact> {
  const userImpact =
    contentType === 'drama' || contentType === 'movie'
      ? await countUserImpact(tx, contentType, id, scope.episodeIds)
      : await countEpisodeImpact(tx, scope.episodeIds);

  const reviewImpact =
    contentType === 'drama' || contentType === 'movie'
      ? await countReviewReferences(tx, id)
      : { ratings: 0, reviews: 0 };

  const analyticsImpact =
    contentType === 'drama' || contentType === 'movie'
      ? await countAnalyticsImpact(tx, contentType, id)
      : { contentViewEvents: 0, playbackEvents: 0, dailyAggregates: 0 };

  const notificationImpact =
    contentType === 'drama' || contentType === 'movie'
      ? await countNotificationImpact(tx, contentType, id)
      : { notifications: 0, adminNotifications: 0 };

  return {
    contentType,
    id,
    title,
    seasons: scope.seasonIds.length,
    episodes: scope.episodeIds.length,
    bookmarks: userImpact.bookmarks,
    playbackProgress: userImpact.playbackProgress,
    watchedState: userImpact.watchedState,
    watchHistory: userImpact.watchHistory,
    ratings: reviewImpact.ratings,
    reviews: reviewImpact.reviews,
    analyticsEvents:
      analyticsImpact.contentViewEvents +
      analyticsImpact.playbackEvents +
      analyticsImpact.dailyAggregates,
    notifications: notificationImpact.notifications + notificationImpact.adminNotifications,
    metadataRows: await countMetadataRows(tx, scope),
  };
}

/** Remove the slug history, SEO rows, and asset rows of the deleted content. */
async function purgeContentMetadata(tx: Tx, scope: DeletionScope): Promise<void> {
  const targetId =
    scope.dramaIds[0] ?? scope.seasonIds[0] ?? scope.episodeIds[0] ?? scope.movieIds[0] ?? null;

  if (targetId === null) {
    return;
  }

  await tx
    .delete(contentSlugHistory)
    .where(and(eq(contentSlugHistory.content_type, scope.metadataType), eq(contentSlugHistory.content_id, targetId)));

  await tx
    .delete(contentSeo)
    .where(and(eq(contentSeo.content_type, scope.metadataType), eq(contentSeo.content_id, targetId)));

  await tx
    .delete(contentAssets)
    .where(and(eq(contentAssets.content_type, scope.metadataType), eq(contentAssets.content_id, targetId)));
}

/** Remove the join rows the content owns. */
async function purgeContentRelations(tx: Tx, contentType: TrashContentType, scope: DeletionScope): Promise<void> {
  if (contentType === 'drama') {
    for (const dramaId of scope.dramaIds) {
      await tx.delete(dramaCategories).where(eq(dramaCategories.drama_id, dramaId));
      await tx.delete(dramaPlatforms).where(eq(dramaPlatforms.drama_id, dramaId));
      await tx
        .delete(similarDramas)
        .where(or(eq(similarDramas.drama_id, dramaId), eq(similarDramas.similar_drama_id, dramaId))!);
      await tx.delete(conversionSnapshots).where(eq(conversionSnapshots.drama_id, dramaId));
    }
  }

  if (contentType === 'movie') {
    for (const movieId of scope.movieIds) {
      await tx.delete(movieCategories).where(eq(movieCategories.movie_id, movieId));
      await tx.delete(moviePlatforms).where(eq(moviePlatforms.movie_id, movieId));
    }
  }
}

/**
 * Permanently delete several trashed items.
 *
 * Each item is deleted in its own transaction, so one failure never leaves the
 * batch half applied and never rolls back an item that was already deleted
 * successfully. The result reports every item separately.
 */
export async function permanentDeleteBulk(
  actor: ActorContext,
  requests: readonly PermanentDeleteRequest[]
): Promise<PermanentDeleteBulkResult> {
  requireSuperAdmin(actor);

  const results: PermanentDeleteItemResult[] = [];

  for (const request of requests) {
    try {
      const impact = await permanentDelete(actor, request.contentType, request.id);

      results.push({
        contentType: request.contentType,
        id: request.id,
        status: 'succeeded',
        message: null,
        impact,
      });
    } catch (error) {
      // Only an application error carries a message that is safe to show. An
      // unexpected failure is logged with its cause and reported generically,
      // so a database error never leaks schema details into the response.
      if (!(error instanceof AppError)) {
        logger.error(
          { err: error, contentType: request.contentType, contentId: request.id },
          'A permanent deletion failed with an unexpected error.'
        );
      }

      results.push({
        contentType: request.contentType,
        id: request.id,
        status: 'failed',
        message:
          error instanceof AppError ? error.message : 'The permanent deletion failed unexpectedly.',
        impact: null,
      });
    }
  }

  const succeeded = results.filter(result => result.status === 'succeeded').length;

  return {
    requested: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}
