import 'server-only';

import { and, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db/client';
import { playableEpisodeExists, publicDramaAvailability, publicMovieAvailability } from '@/modules/content';

import { analytics_daily_aggregates } from '../schema';

/**
 * The cross-module discovery and ranking read models.
 *
 * ARCHITECTURE.md §6.9 designates `analytics/read-models/` as the only place
 * where a read-only join across modules is allowed. This file needs three
 * domains at once:
 *
 *   - `content` decides which items the public may see.
 *   - `reviews` owns the rating rows.
 *   - `analytics` owns the daily activity aggregates.
 *
 * The rankings are computed from *stored* aggregates, never from live event
 * tables, so refreshing a page cannot inflate a ranking.
 *
 * The four rankings are genuinely different measures:
 *
 *   - **Trending** weights recent activity and decays it with age. A title
 *     that was watched heavily last week outranks a title that was watched
 *     heavily last year.
 *   - **Popular** sums the whole history without decay. An old blockbuster
 *     stays high on Popular long after it has left Trending.
 *   - **Most viewed** is the raw view counter over the whole history.
 *   - **Highest Rated** is the mean of the active ratings. Unrated content is
 *     excluded, and no minimum rating count is imposed.
 */

/** The content kinds the public site shows. */
export type RankedContentType = 'drama' | 'movie';

/** The approved ranking orders. */
export type DiscoverySort =
  | 'newest'
  | 'relevance'
  | 'trending'
  | 'popular'
  | 'highest-rated'
  | 'most-viewed';

export const DISCOVERY_SORTS: readonly DiscoverySort[] = [
  'newest',
  'relevance',
  'trending',
  'popular',
  'highest-rated',
  'most-viewed',
];

/** One item of a ranked discovery list. */
export type RankedContent = {
  type: RankedContentType;
  id: string;
  title: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  href: string;
  status: 'ongoing' | 'completed' | null;
  /**
   * Whether the item is listed before it can be played.
   *
   * A drama is "coming soon" when it is public but has no playable episode: it
   * has a poster and a page, but nothing to watch yet. A movie is always
   * available, because a public movie carries a source.
   */
  comingSoon: boolean;
  publishedAt: string | null;
  /** The mean active rating, or `null` when nobody rated the item. */
  ratingAverage: number | null;
  /** How many active ratings the average is based on. */
  ratingCount: number;
  /** The historical view counter. */
  viewCount: number;
  /** The ranking score of the current order. */
  score: number;
  /** Whether an administrator pinned the item into the Trending list. */
  pinned: boolean;
};

/** A bounded page of ranked content. */
export type RankedContentPage = {
  items: RankedContent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

/** The approved discovery query. */
export type DiscoveryQuery = {
  /** `all`, `drama`, or `movie`. */
  type?: 'all' | RankedContentType;
  /** The ranking order. */
  sort?: DiscoverySort;
  page?: number;
  pageSize?: number;
  /** Restrict to one or more category slugs. */
  categorySlugs?: readonly string[];
  /** Restrict to one platform slug. */
  platformSlug?: string;
  /** Restrict to the dramas whose lifecycle status matches. */
  status?: 'all' | 'ongoing' | 'completed';
  /** A search term matched against the title. */
  query?: string;
};

/** Default page size for a discovery grid. */
export const DISCOVERY_PAGE_SIZE_DEFAULT = 24;

/** Maximum page size a public caller may request. */
export const DISCOVERY_PAGE_SIZE_MAX = 100;

/** Upper bound on the page number, so a caller cannot request pathological offsets. */
const DISCOVERY_PAGE_MAX = 1_000_000;

/** How many days of recent activity feed the Trending ranking. */
const TRENDING_WINDOW_DAYS = 14;

/** The half-life of the Trending decay, in days. */
const TRENDING_HALF_LIFE_DAYS = 7;

/** An administrator pin. */
export type TrendingPin = {
  type: RankedContentType;
  id: string;
};

/** The raw row shape the discovery query returns. */
type DiscoveryRow = {
  contentType: RankedContentType;
  id: string;
  title: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  href: string;
  status: string | null;
  comingSoon: boolean;
  publishedAt: Date | null;
  ratingAverage: number | null;
  ratingCount: number;
  viewCount: number;
  trendScore: number;
  popularScore: number;
  relevanceScore: number;
};

/** Clamp the query into the approved bounds. */
function normalizeQuery(query: DiscoveryQuery) {
  const page = Math.max(1, Math.min(Math.floor(query.page ?? 1), DISCOVERY_PAGE_MAX));
  const pageSize = Math.max(
    1,
    Math.min(Math.floor(query.pageSize ?? DISCOVERY_PAGE_SIZE_DEFAULT), DISCOVERY_PAGE_SIZE_MAX)
  );

  const requestedSort = DISCOVERY_SORTS.includes(query.sort as DiscoverySort)
    ? (query.sort as DiscoverySort)
    : 'newest';

  const term = query.query?.trim() || undefined;

  // Relevance needs something to be relevant to: without a term every title
  // would match equally, so the newest order is used instead.
  const sort = requestedSort === 'relevance' && !term ? 'newest' : requestedSort;

  return {
    page,
    pageSize,
    sort,
    type: query.type ?? 'all',
    categorySlugs: query.categorySlugs?.map(slug => slug.trim()).filter(slug => slug.length > 0),
    platformSlug: query.platformSlug?.trim() || undefined,
    status: query.status ?? 'all',
    query: term,
  };
}

/** Escape the LIKE wildcards so a search term is matched literally. */
function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

/**
 * The relevance of a title against a search term.
 *
 * A search must show what the viewer typed before it shows anything else, so
 * the score is a ladder rather than one fuzzy number:
 *
 *   - an exact title match is the strongest signal,
 *   - a title that starts with the term comes next,
 *   - a title that contains the term comes next,
 *   - a full-text match — every word of the term present — comes next,
 *   - and a trigram match, the fuzzy fallback, comes last.
 *
 * The trigram score is scaled to 0–100 so it can never outrank a full-text
 * match. Without this ladder a search for a popular title buries that title
 * under dozens of loosely similar ones, because the trigram index matches
 * anything that shares enough characters.
 */
function relevanceScore(term: string): SQL {
  const contains = `%${escapeLikeTerm(term)}%`;
  const prefix = `${escapeLikeTerm(term)}%`;

  return sql`
    case
      when lower(title) = lower(${term}) then 1000
      when title ilike ${prefix} escape '\\' then 700
      when title ilike ${contains} escape '\\' then 400
      when to_tsvector('simple', title) @@ plainto_tsquery('simple', ${term}) then 200
      else similarity(title, ${term}) * 100
    end
  `;
}

/**
 * The rating aggregate, per content item.
 *
 * Only active ratings count: a soft-deleted rating is not a rating anybody
 * can see, and it must not pull an average down. The count is the number of
 * active rating rows, which is the number of unique users because the
 * database allows one active rating per user and content item.
 */
const ratingAggregate = sql`
  select coalesce(drama_id, movie_id) as content_id,
         avg(value)::float8 as avg_rating,
         count(*)::int as rating_count
    from "ratings"
   where "deleted_at" is null
     and ("drama_id" is not null or "movie_id" is not null)
   group by coalesce(drama_id, movie_id)
`;

/**
 * The recent-activity aggregate used by Trending.
 *
 * The three activity signals are combined and then decayed: a day that is
 * `n` days old counts with the weight `0.5 ^ (n / 7)`, so the activity of
 * one day is worth half as much seven days later and a quarter fourteen days
 * later. The score is a number, not a count of page refreshes, so refreshing
 * a page never changes the order.
 *
 * The age of a day is the interval between today and that day. PostgreSQL
 * casts that interval to a number of *days*, which is the unit the half-life
 * is expressed in.
 *
 * The window length is cast to `int` explicitly. An untyped parameter in
 * `current_date - $1` is resolved by PostgreSQL as a *date*, not as a number
 * of days, so the statement fails with "operator does not exist: date >=
 * integer" instead of subtracting the window.
 */
const trendAggregate = sql`
  select coalesce(drama_id, movie_id) as content_id,
         sum(
           (
             coalesce(unique_visitors, 0) * 1.0
             + coalesce(total_views, 0) * 0.5
             + coalesce(total_watch_duration_seconds, 0) / 60.0 * 0.5
           ) * power(0.5, (current_date - "date"::date)::float8 / ${TRENDING_HALF_LIFE_DAYS}::float8)
         )::float8 as trend_score
    from ${analytics_daily_aggregates}
   where "deleted_at" is null
     and ("drama_id" is not null or "movie_id" is not null)
     and "date"::date >= current_date - ${TRENDING_WINDOW_DAYS}::int
   group by coalesce(drama_id, movie_id)
`;

/**
 * The historical aggregate used by Popular and Most viewed.
 *
 * Unlike Trending, the whole history counts and nothing decays: a title that
 * was watched heavily a year ago still belongs at the top of Popular. That
 * is what makes Popular a different ranking rather than a copy of Trending.
 */
const popularAggregate = sql`
  select coalesce(drama_id, movie_id) as content_id,
         (
           sum(coalesce(unique_visitors, 0)) * 1.0
           + sum(coalesce(total_views, 0)) * 0.5
           + sum(coalesce(total_watch_duration_seconds, 0)) / 60.0 * 0.5
         )::float8 as popular_score,
         sum(coalesce(total_views, 0))::int as view_count
    from ${analytics_daily_aggregates}
   where "deleted_at" is null
     and ("drama_id" is not null or "movie_id" is not null)
   group by coalesce(drama_id, movie_id)
`;

/**
 * The candidate set: every public content item with its ranking signals.
 *
 * The two content kinds are unioned so one query can order and paginate them
 * together; a content-type filter narrows the union instead of splitting the
 * query into two.
 */
function candidateSet(): SQL {
  return sql`
    with rating_agg as (${ratingAggregate}),
    trend_agg as (${trendAggregate}),
    popular_agg as (${popularAggregate})
    select 'drama'::text as content_type,
           "dramas"."id" as id,
           "dramas"."title" as title,
           "dramas"."description" as description,
           "dramas"."poster" as poster,
           "dramas"."banner" as banner,
           ('/drama/' || "dramas"."id"::text || '/' || "dramas"."slug") as href,
           "dramas"."status" as status,
           (not ${playableEpisodeExists()})::bool as coming_soon,
           "dramas"."published_at" as published_at,
           rating_agg.avg_rating as rating_average,
           coalesce(rating_agg.rating_count, 0)::int as rating_count,
           coalesce(popular_agg.view_count, 0)::int as view_count,
           coalesce(trend_agg.trend_score, 0)::float8 as trend_score,
           coalesce(popular_agg.popular_score, 0)::float8 as popular_score
      from "dramas"
      left join rating_agg on rating_agg.content_id = "dramas"."id"
      left join trend_agg on trend_agg.content_id = "dramas"."id"
      left join popular_agg on popular_agg.content_id = "dramas"."id"
     where ${publicDramaAvailability()}
    union all
    select 'movie'::text as content_type,
           "movies"."id" as id,
           "movies"."title" as title,
           "movies"."description" as description,
           "movies"."poster" as poster,
           "movies"."banner" as banner,
           ('/movie/' || "movies"."id"::text || '/' || "movies"."slug") as href,
           null::text as status,
           false::bool as coming_soon,
           "movies"."published_at" as published_at,
           rating_agg.avg_rating as rating_average,
           coalesce(rating_agg.rating_count, 0)::int as rating_count,
           coalesce(popular_agg.view_count, 0)::int as view_count,
           coalesce(trend_agg.trend_score, 0)::float8 as trend_score,
           coalesce(popular_agg.popular_score, 0)::float8 as popular_score
      from "movies"
      left join rating_agg on rating_agg.content_id = "movies"."id"
      left join trend_agg on trend_agg.content_id = "movies"."id"
      left join popular_agg on popular_agg.content_id = "movies"."id"
     where ${publicMovieAvailability()}
  `;
}

/** The filters applied on top of the candidate set. */
function filters(query: ReturnType<typeof normalizeQuery>): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.type !== 'all') {
    conditions.push(sql`content_type = ${query.type}`);
  }

  if (query.status === 'ongoing' || query.status === 'completed') {
    conditions.push(sql`status = ${query.status}`);
  }

  if (query.query) {
    const pattern = `%${escapeLikeTerm(query.query)}%`;

    // Full-text search catches the word forms; the trigram comparison catches
    // the near misses and typos a word index cannot match; the plain pattern
    // keeps a prefix match working for every locale.
    conditions.push(
      sql`(
        title ilike ${pattern} escape '\\'
        or to_tsvector('simple', title) @@ plainto_tsquery('simple', ${query.query})
        or similarity(title, ${query.query}) > 0.25
      )`
    );
  }

  if (query.categorySlugs && query.categorySlugs.length > 0) {
    // The taxonomy filter is an `EXISTS` per content kind, so the candidate
    // set stays a single union instead of one query per kind. Several
    // categories may be selected at once; an item filed under any of them
    // matches.
    //
    // The slugs are bound one by one. A JavaScript array is *not* a
    // PostgreSQL array: binding it as a single parameter produces a malformed
    // array literal, and binding an empty one produces `any()`, which is a
    // syntax error.
    conditions.push(sql`
      (
        (content_type = 'drama' and exists (
          select 1
            from "drama_categories" "dc"
            join "categories" "c" on "c"."id" = "dc"."category_id"
           where "dc"."drama_id" = discovery.id
             and "c"."slug" in (${sql.join(
               query.categorySlugs.map(slug => sql`${slug}`),
               sql`, `
             )})
             and "c"."deleted_at" is null
        ))
        or
        (content_type = 'movie' and exists (
          select 1
            from "movie_categories" "mc"
            join "categories" "c" on "c"."id" = "mc"."category_id"
           where "mc"."movie_id" = discovery.id
             and "c"."slug" in (${sql.join(
               query.categorySlugs.map(slug => sql`${slug}`),
               sql`, `
             )})
             and "c"."deleted_at" is null
        ))
      )
    `);
  }

  if (query.platformSlug) {
    conditions.push(sql`
      (
        (content_type = 'drama' and exists (
          select 1
            from "drama_platforms" "dp"
            join "platforms" "p" on "p"."id" = "dp"."platform_id"
           where "dp"."drama_id" = discovery.id
             and "p"."slug" = ${query.platformSlug}
             and "p"."deleted_at" is null
        ))
        or
        (content_type = 'movie' and exists (
          select 1
            from "movie_platforms" "mp"
            join "platforms" "p" on "p"."id" = "mp"."platform_id"
           where "mp"."movie_id" = discovery.id
             and "p"."slug" = ${query.platformSlug}
             and "p"."deleted_at" is null
        ))
      )
    `);
  }

  if (conditions.length === 0) {
    return undefined;
  }

  return and(...conditions);
}

/** The order of the candidate set for one sort. */
function orderBy(sort: DiscoverySort, pinnedIds: readonly string[]): SQL {
  if (sort === 'relevance') {
    // The relevance score is projected by the outer query, so the order can
    // refer to it by its alias.
    return sql`
      order by "relevanceScore" desc, published_at desc nulls last, title asc, id asc
    `;
  }

  if (sort === 'trending') {
    // An administrator pin puts an item at the head of the Trending list. The
    // pinned ids are bound one by one, so the statement never interpolates a
    // value into SQL text. With no pins the expression is left out entirely:
    // an empty `in ()` list is a syntax error.
    const pinOrder =
      pinnedIds.length > 0
        ? sql`case when id::text in (${sql.join(
            pinnedIds.map(id => sql`${id}`),
            sql`, `
          )}) then 0 else 1 end asc,`
        : sql``;

    return sql`
      order by
        ${pinOrder}
        trend_score desc,
        published_at desc nulls last,
        title asc,
        id asc
    `;
  }

  if (sort === 'popular') {
    return sql`order by popular_score desc, published_at desc nulls last, title asc, id asc`;
  }

  if (sort === 'highest-rated') {
    return sql`
      order by rating_average desc nulls last, rating_count desc, published_at desc nulls last, title asc, id asc
    `;
  }

  if (sort === 'most-viewed') {
    return sql`order by view_count desc, published_at desc nulls last, title asc, id asc`;
  }

  return sql`order by published_at desc nulls last, title asc, id asc`;
}

/** The condition that keeps only the items a sort is defined for. */
function sortScope(sort: DiscoverySort): SQL | undefined {
  if (sort === 'highest-rated') {
    // An unrated item has no average. Showing it at the bottom of a "highest
    // rated" list would be a fabricated score of zero, so it is excluded.
    return sql`rating_count > 0`;
  }

  return undefined;
}

/**
 * The projection that renames the candidate columns.
 *
 * PostgreSQL folds an unquoted alias to lower case, so the candidate set
 * answers with `content_type`, `rating_average`, and so on. The mapper reads
 * camel-case names, and a silent mismatch would produce `undefined` values
 * instead of an error — an item with no rating average would read as `NaN`
 * and a title would lose its type. The aliases are therefore quoted, which
 * keeps the casing exactly as written.
 */
function projection(term?: string): SQL {
  return sql`
    select content_type as "contentType",
           id,
           title,
           description,
           poster,
           banner,
           href,
           status,
           coming_soon as "comingSoon",
           published_at as "publishedAt",
           rating_average as "ratingAverage",
           rating_count as "ratingCount",
           view_count as "viewCount",
           trend_score as "trendScore",
           popular_score as "popularScore",
           ${term ? relevanceScore(term) : sql`0::float8`} as "relevanceScore"
      from (${candidateSet()}) as discovery
  `;
}

/**
 * The ranked discovery grid.
 *
 * One query orders and paginates dramas and movies together, so a page
 * number means the same thing whichever content type the caller asks for.
 */
export async function listRankedContent(
  rawQuery: DiscoveryQuery = {},
  options: { pinnedIds?: readonly string[] } = {}
): Promise<RankedContentPage> {
  const query = normalizeQuery(rawQuery);
  const pinnedIds = options.pinnedIds ?? [];
  const offset = (query.page - 1) * query.pageSize;

  const candidates = candidateSet();
  const scope = filters(query);
  const ratingScope = sortScope(query.sort);

  const scopeCondition = and(scope, ratingScope);

  const rowsResult = await db.execute(sql`
    ${projection(query.query)}
    ${scopeCondition ? sql`where ${scopeCondition}` : sql``}
    ${orderBy(query.sort, pinnedIds)}
    limit ${query.pageSize}
    offset ${offset}
  `);

  const totalResult = await db.execute(sql`
    select count(*)::int as total
      from (${candidates}) as discovery
     ${scopeCondition ? sql`where ${scopeCondition}` : sql``}
  `);

  const total = Number((totalResult.rows[0] as { total?: number } | undefined)?.total ?? 0);
  const rows = rowsResult.rows as unknown as DiscoveryRow[];
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

  const pinned = new Set(pinnedIds);

  const items = rows.map(row => ({
    type: row.contentType,
    id: row.id,
    title: row.title,
    description: row.description,
    poster: row.poster,
    banner: row.banner,
    href: row.href,
    status: normalizeStatus(row.status),
    comingSoon: row.comingSoon === true,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    ratingAverage:
      row.ratingAverage === null ? null : Number(Number(row.ratingAverage).toFixed(2)),
    ratingCount: Number(row.ratingCount ?? 0),
    viewCount: Number(row.viewCount ?? 0),
    score: scoreFor(query.sort, row),
    pinned: pinned.has(row.id),
  }));

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

/** Normalize the lifecycle status the catalogue stores into the two public values. */
function normalizeStatus(value: string | null): 'ongoing' | 'completed' | null {
  if (value === 'ongoing' || value === 'completed') {
    return value;
  }

  return null;
}

/** The score the current order ranks by. */
function scoreFor(sort: DiscoverySort, row: DiscoveryRow): number {
  if (sort === 'trending') {
    return Number(row.trendScore ?? 0);
  }

  if (sort === 'popular') {
    return Number(row.popularScore ?? 0);
  }

  if (sort === 'highest-rated') {
    return Number(row.ratingAverage ?? 0);
  }

  if (sort === 'most-viewed') {
    return Number(row.viewCount ?? 0);
  }

  if (sort === 'relevance') {
    return Number(row.relevanceScore ?? 0);
  }

  return 0;
}

/**
 * The Trending ranking.
 *
 * The same service backs the homepage section and the dedicated Trending
 * page, so the two can never disagree.
 */
export async function listTrendingContent(
  options: {
    type?: 'all' | RankedContentType;
    page?: number;
    pageSize?: number;
    pinnedIds?: readonly string[];
  } = {}
): Promise<RankedContentPage> {
  return listRankedContent(
    {
      type: options.type ?? 'all',
      sort: 'trending',
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 24,
    },
    { pinnedIds: options.pinnedIds ?? [] }
  );
}

/**
 * The Popular ranking.
 *
 * Popular is not Trending with a different label: it sums the whole history
 * without decay, so an old favourite keeps its place.
 */
export async function listPopularContent(
  options: {
    type?: 'all' | RankedContentType;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<RankedContentPage> {
  return listRankedContent({
    type: options.type ?? 'all',
    sort: 'popular',
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 24,
  });
}

/**
 * The Most viewed ranking.
 */
export async function listMostViewedContent(
  options: {
    type?: 'all' | RankedContentType;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<RankedContentPage> {
  return listRankedContent({
    type: options.type ?? 'all',
    sort: 'most-viewed',
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 24,
  });
}

/**
 * The Highest Rated ranking.
 *
 * The average is computed from the active ratings only. An item nobody rated
 * has no average and is not listed, and no minimum rating count is imposed:
 * one honest rating is a real rating.
 */
export async function listHighestRatedContent(
  options: {
    type?: 'all' | RankedContentType;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<RankedContentPage> {
  return listRankedContent({
    type: options.type ?? 'all',
    sort: 'highest-rated',
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 24,
  });
}
