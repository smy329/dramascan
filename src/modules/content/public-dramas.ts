import 'server-only';

import { and, asc, count, eq, exists, isNull, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { serverConfig } from '@/platform/config';

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
 *   AND (the drama is not hidden while it has no playable episode
 *        OR a playable episode exists)
 *
 * "hidden while it has no playable episode" is `EMPTY_DRAMA_VISIBILITY=hidden`
 * for every drama, or the stricter per-drama `visibility = 'hidden'` rule when
 * the global mode is `coming_soon`. A per-drama `coming_soon` value defers to
 * the global mode.
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
    or(notHiddenWhileEmpty(), playableEpisodeExists())
  );
}

/**
 * SQL mirror of `isEmptyDramaHidden`.
 *
 * The global mode is a deployment constant, so it is folded into the predicate
 * at build time: `EMPTY_DRAMA_VISIBILITY=hidden` hides every drama without a
 * playable episode, while the default keeps them visible as coming soon unless
 * the drama opted into the stricter per-drama `hidden` rule.
 *
 * The predicate states the *positive* condition ("this drama is not hidden
 * while it is empty") instead of negating a hidden test. A negated comparison
 * is NULL-safe only by accident: `NOT (visibility = 'hidden')` is NULL, not
 * TRUE, when the column is NULL, and a NULL predicate drops the row from the
 * result. `IS DISTINCT FROM` keeps a NULL visibility on the visible side,
 * which is what the shared rule does as well.
 */
function notHiddenWhileEmpty() {
  if (serverConfig.emptyDramaVisibility === 'hidden') {
    return sql`false`;
  }

  return sql`(${dramas.visibility} is distinct from 'hidden')`;
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

  const items: PublicDramaSummary[] = rows.map(row =>
    toPublicDramaSummary(row as PublicDramaRow, {
      emptyDramaVisibility: serverConfig.emptyDramaVisibility,
    })
  );

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
