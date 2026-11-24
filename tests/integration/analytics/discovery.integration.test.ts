import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Discovery ranking integration coverage.
 *
 * The rankings are the part of the public site that promises to be honest:
 * Trending must reflect recent activity, Popular must reflect the whole
 * history, Highest Rated must reflect the ratings people actually gave, and
 * none of them may show a title the public cannot open.
 *
 * These tests run against the real PostgreSQL test database with real rows in
 * `analytics_daily_aggregates` and `ratings`. Nothing is mocked: the ranking
 * is one SQL statement, and only the database can prove it is right.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for discovery integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, inArray, like, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import {
  listHighestRatedContent,
  listMostViewedContent,
  listPopularContent,
  listRankedContent,
  listTrendingContent,
} from '@/modules/analytics';import {
  categories,
  drama_categories,
  drama_platforms,
  dramas,
  episodes,
  movie_categories,
  movie_platforms,
  movies,
  platforms,
  seasons,
} from '@/modules/content/schema';
import { analytics_daily_aggregates } from '@/modules/analytics/schema';
import { submitDramaRating } from '@/modules/reviews';
import { ratings } from '@/modules/reviews/schema';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-discovery-';

type Seed = {
  suffix: string;
  userId: string;
  recentDramaId: string;
  oldDramaId: string;
  ratedFiveId: string;
  ratedThreeId: string;
  unratedId: string;
  draftId: string;
  trashedId: string;
  movieId: string;
  categoryId: string;
  categorySlug: string;
  platformId: string;
  platformSlug: string;
};

/** The date the database considers today. */
async function databaseToday(): Promise<string> {
  const result = await db.execute(sql`select current_date::text as today`);
  const row = result.rows[0] as { today?: string } | undefined;

  if (!row?.today) {
    throw new Error('The database did not report its current date.');
  }

  return row.today;
}

/** A `YYYY-MM-DD` date a number of days before the database's today. */
function daysBefore(today: string, days: number): string {
  const parsed = new Date(`${today}T00:00:00.000Z`);

  parsed.setUTCDate(parsed.getUTCDate() - days);

  return parsed.toISOString().slice(0, 10);
}

async function seed(): Promise<Seed> {
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const categoryId = randomUUID();
  const platformId = randomUUID();
  const categorySlug = `${TEST_PREFIX}category-${suffix}`;
  const platformSlug = `${TEST_PREFIX}platform-${suffix}`;

  await db.insert(users).values({
    id: userId,
    name: 'Discovery tester',
    email: `${TEST_PREFIX}${suffix}@example.com`,
  });

  await db.insert(categories).values({
    id: categoryId,
    name: `Discovery category ${suffix}`,
    slug: categorySlug,
    visibility: 'visible',
    position: 0,
  });

  await db.insert(platforms).values({
    id: platformId,
    name: `Discovery platform ${suffix}`,
    slug: platformSlug,
    position: 0,
  });

  const dramaIds = {
    recentDramaId: randomUUID(),
    oldDramaId: randomUUID(),
    ratedFiveId: randomUUID(),
    ratedThreeId: randomUUID(),
    unratedId: randomUUID(),
    draftId: randomUUID(),
    trashedId: randomUUID(),
  };

  for (const [key, id] of Object.entries(dramaIds)) {
    const seasonId = randomUUID();

    await db.insert(dramas).values({
      id,
      title: `Discovery ${key} ${suffix}`,
      slug: `${TEST_PREFIX}${key}-${suffix}`,
      structure_type: 'season_based',
      status: 'ongoing',
      publication_status: key === 'draftId' ? 'draft' : 'published',
      visibility: 'coming_soon',
      deleted_at: key === 'trashedId' ? new Date() : null,
    });

    await db.insert(seasons).values({
      id: seasonId,
      drama_id: id,
      title: 'Season 1',
      position: 0,
      publication_status: 'published',
    });

    await db.insert(episodes).values({
      id: randomUUID(),
      drama_id: id,
      season_id: seasonId,
      title: 'Episode 1',
      episode_number: 1,
      position: 0,
      publication_status: 'published',
      video_source: 'https://media.example.com/episodes/discovery.mp4',
    });
  }

  const movieId = randomUUID();

  await db.insert(movies).values({
    id: movieId,
    title: `Discovery movie ${suffix}`,
    slug: `${TEST_PREFIX}movie-${suffix}`,
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/discovery.mp4',
  });

  // The recent title is active today; the old title was active two months ago.
  await db.insert(analytics_daily_aggregates).values([
    {
      date: daysBefore(await databaseToday(), 0),
      drama_id: dramaIds.recentDramaId,
      content_type: 'drama',
      unique_visitors: 100,
      total_views: 200,
      total_watch_duration_seconds: 6000,
    },
    {
      date: daysBefore(await databaseToday(), 60),
      drama_id: dramaIds.oldDramaId,
      content_type: 'drama',
      unique_visitors: 1000,
      total_views: 2000,
      total_watch_duration_seconds: 60000,
    },
  ]);

  await submitDramaRating(userId, dramaIds.ratedFiveId, 5);
  await submitDramaRating(userId, dramaIds.ratedThreeId, 3);

  return {
    suffix,
    userId,
    ...dramaIds,
    movieId,
    categoryId,
    categorySlug,
    platformId,
    platformSlug,
  };
}

/**
 * Seed a set of published titles with the given names.
 *
 * The titles are matched by the cleanup through the fixture slug prefix, so
 * they disappear with the rest of the fixture rows.
 */
async function seedTitles(titles: readonly string[]): Promise<void> {
  const suffix = randomUUID().slice(0, 8);

  for (const [index, title] of titles.entries()) {
    const id = randomUUID();
    const seasonId = randomUUID();

    await db.insert(dramas).values({
      id,
      title,
      slug: `${TEST_PREFIX}title-${index}-${suffix}`,
      structure_type: 'season_based',
      status: 'ongoing',
      publication_status: 'published',
      visibility: 'coming_soon',
    });

    await db.insert(seasons).values({
      id: seasonId,
      drama_id: id,
      title: 'Season 1',
      position: 0,
      publication_status: 'published',
    });

    await db.insert(episodes).values({
      id: randomUUID(),
      drama_id: id,
      season_id: seasonId,
      title: 'Episode 1',
      episode_number: 1,
      position: 0,
      publication_status: 'published',
      video_source: 'https://media.example.com/episodes/discovery.mp4',
    });
  }
}

async function cleanup(): Promise<void> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_PREFIX}%`));

  const userIds = userRows.map(row => row.id);

  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_PREFIX}%`));

  const dramaIds = dramaRows.map(row => row.id);

  const movieRows = await db
    .select({ id: movies.id })
    .from(movies)
    .where(like(movies.slug, `${TEST_PREFIX}%`));

  const movieIds = movieRows.map(row => row.id);

  const categoryRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(like(categories.slug, `${TEST_PREFIX}%`));

  const categoryIds = categoryRows.map(row => row.id);

  const platformRows = await db
    .select({ id: platforms.id })
    .from(platforms)
    .where(like(platforms.slug, `${TEST_PREFIX}%`));

  const platformIds = platformRows.map(row => row.id);

  if (dramaIds.length > 0) {
    await db.delete(ratings).where(inArray(ratings.drama_id, dramaIds));
    await db.delete(analytics_daily_aggregates).where(
      inArray(analytics_daily_aggregates.drama_id, dramaIds)
    );
    await db.delete(drama_categories).where(inArray(drama_categories.drama_id, dramaIds));
    await db.delete(drama_platforms).where(inArray(drama_platforms.drama_id, dramaIds));
    await db.delete(episodes).where(inArray(episodes.drama_id, dramaIds));
    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  if (movieIds.length > 0) {
    await db.delete(ratings).where(inArray(ratings.movie_id, movieIds));
    await db.delete(analytics_daily_aggregates).where(
      inArray(analytics_daily_aggregates.movie_id, movieIds)
    );
    await db.delete(movie_categories).where(inArray(movie_categories.movie_id, movieIds));
    await db.delete(movie_platforms).where(inArray(movie_platforms.movie_id, movieIds));
    await db.delete(movies).where(inArray(movies.id, movieIds));
  }

  if (categoryIds.length > 0) {
    await db.delete(drama_categories).where(inArray(drama_categories.category_id, categoryIds));
    await db.delete(movie_categories).where(inArray(movie_categories.category_id, categoryIds));
    await db.delete(categories).where(inArray(categories.id, categoryIds));
  }

  if (platformIds.length > 0) {
    await db.delete(drama_platforms).where(inArray(drama_platforms.platform_id, platformIds));
    await db.delete(movie_platforms).where(inArray(movie_platforms.platform_id, platformIds));
    await db.delete(platforms).where(inArray(platforms.id, platformIds));
  }

  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('the Trending and Popular rankings', () => {
  it('ranks the recently active title above the older one in Trending', async () => {
    const seeded = await seed();

    const page = await listRankedContent({
      sort: 'trending',
      query: seeded.suffix,
      pageSize: 100,
    });
    const ids = page.items.map(item => item.id);

    expect(ids).toContain(seeded.recentDramaId);
    expect(ids.indexOf(seeded.recentDramaId)).toBeLessThan(ids.indexOf(seeded.oldDramaId));
  });

  it('ranks the older title above the recently active one in Popular', async () => {
    const seeded = await seed();

    const page = await listRankedContent({
      sort: 'popular',
      query: seeded.suffix,
      pageSize: 100,
    });
    const ids = page.items.map(item => item.id);

    expect(ids).toContain(seeded.oldDramaId);
    expect(ids.indexOf(seeded.oldDramaId)).toBeLessThan(ids.indexOf(seeded.recentDramaId));
  });

  it('gives the two rankings different orders', async () => {
    const seeded = await seed();

    const trending = (
      await listRankedContent({ sort: 'trending', query: seeded.suffix, pageSize: 100 })
    ).items.map(item => item.id);
    const popular = (
      await listRankedContent({ sort: 'popular', query: seeded.suffix, pageSize: 100 })
    ).items.map(item => item.id);

    expect(trending).not.toEqual(popular);
  });

  it('scores the recent title above the old one in Trending only', async () => {
    const seeded = await seed();

    const trending = (
      await listRankedContent({ sort: 'trending', query: seeded.suffix, pageSize: 100 })
    ).items;
    const popular = (
      await listRankedContent({ sort: 'popular', query: seeded.suffix, pageSize: 100 })
    ).items;

    const trendingScore = trending.find(item => item.id === seeded.recentDramaId)?.score ?? 0;
    const oldTrendingScore = trending.find(item => item.id === seeded.oldDramaId)?.score ?? 0;
    const popularScore = popular.find(item => item.id === seeded.oldDramaId)?.score ?? 0;
    const recentPopularScore = popular.find(item => item.id === seeded.recentDramaId)?.score ?? 0;

    expect(trendingScore).toBeGreaterThan(oldTrendingScore);
    expect(popularScore).toBeGreaterThan(recentPopularScore);
  });

  it('orders Most viewed by the historical view counter', async () => {
    const seeded = await seed();

    const page = await listRankedContent({
      sort: 'most-viewed',
      query: seeded.suffix,
      pageSize: 100,
    });
    const ids = page.items.map(item => item.id);

    expect(ids.indexOf(seeded.oldDramaId)).toBeLessThan(ids.indexOf(seeded.recentDramaId));

    const old = page.items.find(item => item.id === seeded.oldDramaId);

    expect(old?.viewCount).toBe(2000);
  });

  it('does not change the ranking when a page is read again', async () => {
    const seeded = await seed();

    const query = { sort: 'trending' as const, query: seeded.suffix, pageSize: 100 };

    const first = (await listRankedContent(query)).items.map(item => item.id);
    const second = (await listRankedContent(query)).items.map(item => item.id);

    expect(second).toEqual(first);
  });

  it('serves the same Trending order from the homepage service and the grid', async () => {
    await seed();

    const service = (await listTrendingContent({ pageSize: 100 })).items.map(item => item.id);
    const grid = (await listRankedContent({ sort: 'trending', pageSize: 100 })).items.map(
      item => item.id
    );

    expect(service).toEqual(grid);
  });

  it('serves the same order from every ranking service and the grid', async () => {
    await seed();

    const popular = (await listPopularContent({ pageSize: 100 })).items.map(item => item.id);
    const gridPopular = (
      await listRankedContent({ sort: 'popular', pageSize: 100 })
    ).items.map(item => item.id);

    expect(popular).toEqual(gridPopular);

    const highestRated = (await listHighestRatedContent({ pageSize: 100 })).items.map(
      item => item.id
    );
    const gridHighestRated = (
      await listRankedContent({ sort: 'highest-rated', pageSize: 100 })
    ).items.map(item => item.id);

    expect(highestRated).toEqual(gridHighestRated);

    const mostViewed = (await listMostViewedContent({ pageSize: 100 })).items.map(item => item.id);
    const gridMostViewed = (
      await listRankedContent({ sort: 'most-viewed', pageSize: 100 })
    ).items.map(item => item.id);

    expect(mostViewed).toEqual(gridMostViewed);
  });

  it('puts a pinned title first in Trending', async () => {
    const seeded = await seed();

    const page = await listTrendingContent({
      pageSize: 100,
      pinnedIds: [seeded.oldDramaId],
    });

    expect(page.items[0]?.id).toBe(seeded.oldDramaId);
    expect(page.items[0]?.pinned).toBe(true);
  });
});

describe('the Highest Rated ranking', () => {
  it('orders the titles by the mean of their active ratings', async () => {
    const seeded = await seed();

    const page = await listRankedContent({
      sort: 'highest-rated',
      query: seeded.suffix,
      pageSize: 100,
    });
    const ids = page.items.map(item => item.id);

    expect(ids.indexOf(seeded.ratedFiveId)).toBeLessThan(ids.indexOf(seeded.ratedThreeId));

    const five = page.items.find(item => item.id === seeded.ratedFiveId);

    expect(five?.ratingAverage).toBe(5);
    expect(five?.ratingCount).toBe(1);
  });

  it('excludes a title nobody rated', async () => {
    const seeded = await seed();

    const page = await listRankedContent({
      sort: 'highest-rated',
      query: seeded.suffix,
      pageSize: 100,
    });
    const ids = page.items.map(item => item.id);

    expect(ids).not.toContain(seeded.unratedId);
  });

  it('ignores a soft-deleted rating', async () => {
    const seeded = await seed();

    await db
      .update(ratings)
      .set({ deleted_at: new Date() })
      .where(and(eq(ratings.drama_id, seeded.ratedFiveId), eq(ratings.user_id, seeded.userId)));

    const page = await listRankedContent({
      sort: 'highest-rated',
      query: seeded.suffix,
      pageSize: 100,
    });
    const ids = page.items.map(item => item.id);

    expect(ids).not.toContain(seeded.ratedFiveId);
  });
});

describe('the public availability rules', () => {
  it('never lists an unpublished title', async () => {
    const seeded = await seed();

    const page = await listRankedContent({ query: seeded.suffix, pageSize: 100 });
    const ids = page.items.map(item => item.id);

    expect(ids).not.toContain(seeded.draftId);
  });

  it('never lists a trashed title', async () => {
    const seeded = await seed();

    const page = await listRankedContent({ query: seeded.suffix, pageSize: 100 });
    const ids = page.items.map(item => item.id);

    expect(ids).not.toContain(seeded.trashedId);
  });

  it('lists a published movie', async () => {
    const seeded = await seed();

    const page = await listRankedContent({ query: seeded.suffix, pageSize: 100 });
    const ids = page.items.map(item => item.id);

    expect(ids).toContain(seeded.movieId);
  });
});

describe('the search relevance order', () => {
  it('puts the exact title first, even when another title sorts before it alphabetically', async () => {
    await seedTitles(['Nightfall', 'AAA Nightfall Return']);

    const page = await listRankedContent({
      sort: 'relevance',
      query: 'Nightfall',
      pageSize: 20,
    });

    const titles = page.items.map(item => item.title);

    expect(titles[0]).toBe('Nightfall');
  });

  it('orders an exact match, a prefix, a partial match, and a typo in that order', async () => {
    await seedTitles(['Nightfall', 'Nightfall Chronicle', 'The Nightfall Legend', 'Nightfll']);

    const page = await listRankedContent({
      sort: 'relevance',
      query: 'Nightfall',
      pageSize: 20,
    });

    const titles = page.items.map(item => item.title);

    expect(titles.indexOf('Nightfall')).toBeLessThan(titles.indexOf('Nightfall Chronicle'));
    expect(titles.indexOf('Nightfall Chronicle')).toBeLessThan(
      titles.indexOf('The Nightfall Legend')
    );
    expect(titles.indexOf('The Nightfall Legend')).toBeLessThan(titles.indexOf('Nightfll'));
  });

  it('reports the relevance score of the current order', async () => {
    await seedTitles(['Nightfall']);

    const page = await listRankedContent({
      sort: 'relevance',
      query: 'Nightfall',
      pageSize: 20,
    });

    const exact = page.items.find(item => item.title === 'Nightfall');

    expect(exact?.score).toBe(1000);
  });

  it('falls back to the newest order when there is no term to be relevant to', async () => {
    await seedTitles(['Nightfall']);

    const page = await listRankedContent({ sort: 'relevance', pageSize: 20 });

    expect(page.items.length).toBeGreaterThan(0);
  });
});

describe('the discovery filters', () => {
  it('restricts the list to one category', async () => {
    const seeded = await seed();

    const categoryId = randomUUID();
    const categorySlug = `${seeded.categorySlug}-two`;

    await db.insert(categories).values({
      id: categoryId,
      name: `Discovery category two ${seeded.categorySlug}`,
      slug: categorySlug,
      visibility: 'visible',
      position: 1,
    });

    await db
      .insert(drama_categories)
      .values({ drama_id: seeded.recentDramaId, category_id: categoryId });

    const page = await listRankedContent({
      pageSize: 100,
      categorySlugs: [categorySlug],
    });

    expect(page.items.map(item => item.id)).toEqual([seeded.recentDramaId]);
  });

  it('restricts the list to one platform', async () => {
    const seeded = await seed();

    const platformId = randomUUID();
    const platformSlug = `${seeded.platformSlug}-two`;

    await db.insert(platforms).values({
      id: platformId,
      name: `Discovery platform two ${seeded.platformSlug}`,
      slug: platformSlug,
      position: 1,
    });

    await db
      .insert(drama_platforms)
      .values({ drama_id: seeded.oldDramaId, platform_id: platformId });

    const page = await listRankedContent({ pageSize: 100, platformSlug });

    expect(page.items.map(item => item.id)).toEqual([seeded.oldDramaId]);
  });
});

describe('the browse catalogue', () => {
  /**
   * Seed one drama with the given lifecycle status and playability.
   *
   * The slug carries the fixture prefix, so the cleanup removes the row with
   * the rest of the fixture.
   */
  async function seedBrowseDrama(input: {
    suffix: string;
    label: string;
    status: 'ongoing' | 'completed';
    playable: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const seasonId = randomUUID();

    await db.insert(dramas).values({
      id,
      title: `Browse ${input.label} ${input.suffix}`,
      slug: `${TEST_PREFIX}browse-${input.label}-${input.suffix}`,
      structure_type: 'season_based',
      status: input.status,
      publication_status: 'published',
      visibility: 'coming_soon',
    });

    await db.insert(seasons).values({
      id: seasonId,
      drama_id: id,
      title: 'Season 1',
      position: 0,
      publication_status: 'published',
    });

    if (input.playable) {
      await db.insert(episodes).values({
        id: randomUUID(),
        drama_id: id,
        season_id: seasonId,
        title: 'Episode 1',
        episode_number: 1,
        position: 0,
        publication_status: 'published',
        video_source: 'https://media.example.com/episodes/browse.mp4',
      });
    }

    return id;
  }

  it('reports a drama without a playable episode as coming soon', async () => {
    const suffix = randomUUID().slice(0, 8);
    const playableId = await seedBrowseDrama({
      suffix,
      label: 'playable',
      status: 'ongoing',
      playable: true,
    });
    const comingSoonId = await seedBrowseDrama({
      suffix,
      label: 'coming',
      status: 'ongoing',
      playable: false,
    });

    const page = await listRankedContent({
      type: 'drama',
      query: `Browse ${suffix}`,
      pageSize: 100,
    });

    const playable = page.items.find(item => item.id === playableId);
    const comingSoon = page.items.find(item => item.id === comingSoonId);

    expect(playable?.comingSoon).toBe(false);
    expect(comingSoon?.comingSoon).toBe(true);
  });

  it('reports a movie as available, because a public movie carries a source', async () => {
    const seeded = await seed();

    const page = await listRankedContent({
      type: 'movie',
      query: seeded.suffix,
      pageSize: 100,
    });

    const movie = page.items.find(item => item.id === seeded.movieId);

    expect(movie?.comingSoon).toBe(false);
  });

  it('restricts the list to the completed dramas when the status filter says so', async () => {
    const suffix = randomUUID().slice(0, 8);
    const completedId = await seedBrowseDrama({
      suffix,
      label: 'completed',
      status: 'completed',
      playable: true,
    });
    const ongoingId = await seedBrowseDrama({
      suffix,
      label: 'ongoing',
      status: 'ongoing',
      playable: true,
    });

    const page = await listRankedContent({
      type: 'drama',
      status: 'completed',
      query: `Browse ${suffix}`,
      pageSize: 100,
    });

    const ids = page.items.map(item => item.id);

    // The completed series are counted, and the ongoing ones are not. The old
    // catalogue page reported the number of *all* dramas here.
    expect(ids).toContain(completedId);
    expect(ids).not.toContain(ongoingId);
    expect(page.total).toBe(ids.length);
  });

  it('keeps the ongoing dramas when the status filter says so', async () => {
    const suffix = randomUUID().slice(0, 8);
    const completedId = await seedBrowseDrama({
      suffix,
      label: 'completed',
      status: 'completed',
      playable: true,
    });
    const ongoingId = await seedBrowseDrama({
      suffix,
      label: 'ongoing',
      status: 'ongoing',
      playable: true,
    });

    const page = await listRankedContent({
      type: 'drama',
      status: 'ongoing',
      query: `Browse ${suffix}`,
      pageSize: 100,
    });

    const ids = page.items.map(item => item.id);

    expect(ids).toContain(ongoingId);
    expect(ids).not.toContain(completedId);
  });

  it('returns only movies when the browse page asks for movies', async () => {
    const seeded = await seed();

    const page = await listRankedContent({
      type: 'movie',
      query: seeded.suffix,
      pageSize: 100,
    });

    expect(page.items.every(item => item.type === 'movie')).toBe(true);
    expect(page.items.map(item => item.id)).toContain(seeded.movieId);
  });
});
