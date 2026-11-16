import 'server-only';

import { and, asc, count, eq, exists, isNull, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';

import {
  parsePublicDramaListQuery,
  toPublicDramaSummary,
  type PublicDramaList,
  type PublicDramaRow,
  type PublicDramaSummary,
} from './public-dramas.shared';
import { dramas, episodes, seasons } from './schema';

/**
 * Public drama catalogue queries.
 *
 * This is the single place that decides whether a drama may appear in anonymous
 * discovery. Every public listing, API response, and catalogue page must use it;
 * no caller-supplied query parameter can widen the result.
 *
 * Availability is evaluated in SQL so pagination counts and page contents stay
 * consistent and the catalogue is never loaded whole. The predicate mirrors
 * `evaluatePublicDramaDiscovery` for the item's own state and extends it with
 * the hierarchy rules:
 *
 *   published drama, not in Trash
 *   AND (visibility is not Hide Until Episodes Available
 *        OR a playable episode exists)
 *   playable episode = published, not in Trash, non-empty source,
 *                      under a published, non-deleted season when the drama
 *                      is season-based.
 *
 * Source syntax is validated when an episode is published; this query only
 * proves a source is present. Phase 7 makes playback verification authoritative.
 */

/**
 * Correlated `EXISTS` for a playable episode of the outer `dramas` row.
 *
 * Season-based dramas require a published, non-deleted season. Flat dramas do
 * not: their episodes carry no season and are ordered directly under the drama.
 */
function playableEpisodeExists() {
  return exists(
    db
      .select({ one: sql`1` })
      .from(episodes)
      .leftJoin(seasons, eq(seasons.id, episodes.season_id))
      .where(
        and(
          eq(episodes.drama_id, dramas.id),
          eq(episodes.publication_status, 'published'),
          isNull(episodes.deleted_at),
          isNotNull(episodes.video_source),
          sql`btrim(${episodes.video_source}) <> ''`,
          or(
            eq(dramas.structure_type, 'flat'),
            and(
              isNotNull(episodes.season_id),
              eq(seasons.publication_status, 'published'),
              isNull(seasons.deleted_at)
            )
          )
        )
      )
  );
}

/** Rows an anonymous visitor may discover, independent of the caller's query. */
function discoverableDrama() {
  return and(
    isNull(dramas.deleted_at),
    eq(dramas.publication_status, 'published'),
    or(sql`${dramas.visibility} is distinct from 'hidden'`, playableEpisodeExists())
  );
}

/** List the public drama catalogue, ordered by title with a unique tiebreaker. */
export async function listPublicDramas(rawQuery: unknown = {}): Promise<PublicDramaList> {
  const query = parsePublicDramaListQuery(rawQuery);
  const offset = (query.page - 1) * query.pageSize;
  const availability = discoverableDrama();

  const [[totalRow], rows] = await Promise.all([
    db.select({ total: count() }).from(dramas).where(availability),
    db
      .select({
        id: dramas.id,
        title: dramas.title,
        slug: dramas.slug,
        description: dramas.description,
        poster: dramas.poster,
        banner: dramas.banner,
        status: dramas.status,
        visibility: dramas.visibility,
        publicationStatus: dramas.publication_status,
        deleted: sql<boolean>`${dramas.deleted_at} is not null`,
        hasPlayableEpisode: sql<boolean>`${playableEpisodeExists()}`,
        createdAt: dramas.created_at,
        updatedAt: dramas.updated_at,
      })
      .from(dramas)
      .where(availability)
      .orderBy(asc(dramas.title), asc(dramas.id))
      .limit(query.pageSize)
      .offset(offset),
  ]);

  const total = Number(totalRow?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

  const items: PublicDramaSummary[] = rows.map(row => toPublicDramaSummary(row as PublicDramaRow));

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages,
    hasNextPage: query.page < totalPages,
    hasPreviousPage: query.page > 1 && totalPages > 0,
  };
}
