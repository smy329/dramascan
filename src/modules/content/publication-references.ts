import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { dramas, episodes, seasons } from './schema';

/**
 * The publishable content references (D-076).
 *
 * When a drama, a season, or an episode becomes public, the platform announces
 * it. The announcement needs the title of the content and the deep link of the
 * page it lives on — and the content module owns both the titles and the
 * hierarchy.
 *
 * The publication workflow therefore asks this module for the rows it may
 * announce instead of querying the content tables itself: a workflow
 * coordinates modules, it does not read their tables (ARCHITECTURE §5.2).
 *
 * A trashed row is never named: it is not public, and announcing it would
 * send a viewer to a page that answers 404.
 */

/** One published drama. */
export type PublishedDramaReference = {
  /** The drama id. */
  id: string;
  /** The title the viewer sees. */
  title: string;
  /** The slug of the public page. */
  slug: string;
};

/** One published season or episode, with the drama it belongs to. */
export type PublishedHierarchyReference = {
  /** The season or episode id. */
  id: string;
  /** The title the viewer sees. */
  title: string;
  /** The id of the drama it belongs to. */
  dramaId: string;
  /** The title of the drama it belongs to. */
  dramaTitle: string;
  /** The slug of the drama's public page. */
  dramaSlug: string;
};

/** The most rows one read may answer. */
const MAX_REFERENCE_ROWS = 500;

/**
 * The dramas of a list, when they are not trashed.
 *
 * @param ids the drama ids
 * @param executor the database executor
 * @returns the dramas, in the order the database returns them
 */
export async function listPublishedDramaReferences(
  ids: readonly string[],
  executor: DbExecutor = db
): Promise<PublishedDramaReference[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await executor
    .select({ id: dramas.id, title: dramas.title, slug: dramas.slug })
    .from(dramas)
    .where(
      and(
        inArray(dramas.id, ids.slice(0, MAX_REFERENCE_ROWS)),
        isNull(dramas.deleted_at)
      )
    );

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
  }));
}

/**
 * The seasons of a list, with their drama, when they are not trashed.
 *
 * @param ids the season ids
 * @param executor the database executor
 * @returns the seasons, in the order the database returns them
 */
export async function listPublishedSeasonReferences(
  ids: readonly string[],
  executor: DbExecutor = db
): Promise<PublishedHierarchyReference[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await executor
    .select({
      id: seasons.id,
      title: seasons.title,
      dramaId: seasons.drama_id,
      dramaTitle: dramas.title,
      dramaSlug: dramas.slug,
    })
    .from(seasons)
    .innerJoin(dramas, eq(seasons.drama_id, dramas.id))
    .where(
      and(
        inArray(seasons.id, ids.slice(0, MAX_REFERENCE_ROWS)),
        isNull(seasons.deleted_at),
        isNull(dramas.deleted_at)
      )
    );

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    dramaId: row.dramaId,
    dramaTitle: row.dramaTitle,
    dramaSlug: row.dramaSlug,
  }));
}

/**
 * The episodes of a list, with their drama, when they are not trashed.
 *
 * @param ids the episode ids
 * @param executor the database executor
 * @returns the episodes, in the order the database returns them
 */
export async function listPublishedEpisodeReferences(
  ids: readonly string[],
  executor: DbExecutor = db
): Promise<PublishedHierarchyReference[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await executor
    .select({
      id: episodes.id,
      title: episodes.title,
      dramaId: episodes.drama_id,
      dramaTitle: dramas.title,
      dramaSlug: dramas.slug,
    })
    .from(episodes)
    .innerJoin(dramas, eq(episodes.drama_id, dramas.id))
    .where(
      and(
        inArray(episodes.id, ids.slice(0, MAX_REFERENCE_ROWS)),
        isNull(episodes.deleted_at),
        isNull(dramas.deleted_at)
      )
    );

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    dramaId: row.dramaId,
    dramaTitle: row.dramaTitle,
    dramaSlug: row.dramaSlug,
  }));
}
