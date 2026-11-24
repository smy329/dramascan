import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reviews integration coverage.
 *
 * Ratings, reviews, reactions, and reports are the community-facing part of
 * the catalogue. The rules that matter are enforced in the database: one
 * active rating and one review per viewer per content item, one reaction per
 * viewer per review, and one active report per viewer per review.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for review integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, like, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import {
  getRatingSummary,
  getReviewEnjoyingCount,
  getUserRating,
  getUserReview,
  listReviews,
  resolveReviewReport,
  submitDramaRating,
  submitDramaReview,
  submitMovieRating,
  submitMovieReview,
  submitReviewReport,
  toggleReviewEnjoying,
} from '@/modules/reviews';
import {
  ratings,
  review_reactions,
  review_reports,
  reviews,
} from '@/modules/reviews/schema';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-review-';

type Seed = {
  userId: string;
  otherUserId: string;
  dramaId: string;
  movieId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const movieId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await db.insert(users).values([
    {
      id: userId,
      name: 'Review tester',
      email: `${TEST_PREFIX}${suffix}@example.com`,
    },
    {
      id: otherUserId,
      name: 'Other reviewer',
      email: `${TEST_PREFIX}other-${suffix}@example.com`,
    },
  ]);

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Review drama',
    slug: `${TEST_PREFIX}${suffix}`,
    structure_type: 'season_based',
    status: 'ongoing',
    publication_status: 'published',
    visibility: 'coming_soon',
  });

  await db.insert(seasons).values({
    id: seasonId,
    drama_id: dramaId,
    title: 'Season 1',
    position: 0,
    publication_status: 'published',
  });

  await db.insert(episodes).values({
    id: episodeId,
    drama_id: dramaId,
    season_id: seasonId,
    title: 'Episode 1',
    episode_number: 1,
    position: 0,
    publication_status: 'published',
    video_source: 'https://media.example.com/episodes/1.mp4',
  });

  await db.insert(movies).values({
    id: movieId,
    title: 'Review film',
    slug: `${TEST_PREFIX}${suffix}`,
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/1.mp4',
  });

  return { userId, otherUserId, dramaId, movieId };
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_PREFIX}%`));

  const movieRows = await db
    .select({ id: movies.id })
    .from(movies)
    .where(like(movies.slug, `${TEST_PREFIX}%`));

  const dramaIds = dramaRows.map(row => row.id);
  const movieIds = movieRows.map(row => row.id);

  for (const dramaId of dramaIds) {
    const reviewRows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.drama_id, dramaId));

    const reviewIds = reviewRows.map(row => row.id);

    if (reviewIds.length > 0) {
      await db.delete(review_reactions).where(
        or(...reviewIds.map(id => eq(review_reactions.review_id, id)))
      );
      await db.delete(review_reports).where(
        or(...reviewIds.map(id => eq(review_reports.review_id, id)))
      );
      await db.delete(reviews).where(eq(reviews.drama_id, dramaId));
    }

    await db.delete(ratings).where(eq(ratings.drama_id, dramaId));
  }

  for (const movieId of movieIds) {
    const reviewRows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.movie_id, movieId));

    const reviewIds = reviewRows.map(row => row.id);

    if (reviewIds.length > 0) {
      await db.delete(review_reactions).where(
        or(...reviewIds.map(id => eq(review_reactions.review_id, id)))
      );
      await db.delete(review_reports).where(
        or(...reviewIds.map(id => eq(review_reports.review_id, id)))
      );
      await db.delete(reviews).where(eq(reviews.movie_id, movieId));
    }

    await db.delete(ratings).where(eq(ratings.movie_id, movieId));
  }

  if (dramaIds.length > 0) {
    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(or(...dramaIds.map(id => eq(episodes.drama_id, id))));

    const episodeIds = episodeRows.map(row => row.id);

    if (episodeIds.length > 0) {
      await db.delete(episodes).where(or(...episodeIds.map(id => eq(episodes.id, id))));
    }

    await db.delete(seasons).where(or(...dramaIds.map(id => eq(seasons.drama_id, id))));
    await db.delete(dramas).where(or(...dramaIds.map(id => eq(dramas.id, id))));
  }

  if (movieIds.length > 0) {
    await db.delete(movies).where(or(...movieIds.map(id => eq(movies.id, id))));
  }

  await db.delete(users).where(like(users.email, `${TEST_PREFIX}%`));
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

describe('submitDramaRating', () => {
  it('keeps one active rating per viewer and updates it in place', async () => {
    const seeded = await seed();

    await submitDramaRating(seeded.userId, seeded.dramaId, 3);
    await submitDramaRating(seeded.userId, seeded.dramaId, 5);

    const rows = await db
      .select()
      .from(ratings)
      .where(
        and(eq(ratings.user_id, seeded.userId), eq(ratings.drama_id, seeded.dramaId))
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(5);
  });

  it('rejects a score outside the five-point scale', async () => {
    const seeded = await seed();

    await expect(submitDramaRating(seeded.userId, seeded.dramaId, 0)).rejects.toThrow(
      /between 1 and 5/
    );
    await expect(submitDramaRating(seeded.userId, seeded.dramaId, 6)).rejects.toThrow(
      /between 1 and 5/
    );
    await expect(submitDramaRating(seeded.userId, seeded.dramaId, 4.5)).rejects.toThrow(
      /between 1 and 5/
    );
  });

  it('counts unique viewers, not rating changes', async () => {
    const seeded = await seed();

    await submitDramaRating(seeded.userId, seeded.dramaId, 3);
    await submitDramaRating(seeded.userId, seeded.dramaId, 5);
    await submitDramaRating(seeded.otherUserId, seeded.dramaId, 4);

    const summary = await getRatingSummary('drama', seeded.dramaId);

    expect(summary?.count).toBe(2);
    expect(summary?.average).toBeCloseTo(4.5, 5);
  });

  it('reports no summary when nobody rated the item', async () => {
    const seeded = await seed();

    expect(await getRatingSummary('drama', seeded.dramaId)).toBeNull();
  });

  it('reads the viewer own rating', async () => {
    const seeded = await seed();

    expect(await getUserRating(seeded.userId, 'drama', seeded.dramaId)).toBeNull();

    await submitDramaRating(seeded.userId, seeded.dramaId, 4);

    expect(await getUserRating(seeded.userId, 'drama', seeded.dramaId)).toBe(4);
    expect(await getUserRating(null, 'drama', seeded.dramaId)).toBeNull();
  });

  it('rates a standalone movie', async () => {
    const seeded = await seed();

    await submitMovieRating(seeded.userId, seeded.movieId, 2);

    const summary = await getRatingSummary('movie', seeded.movieId);

    expect(summary?.count).toBe(1);
    expect(summary?.average).toBe(2);
  });
});

describe('submitDramaReview', () => {
  it('creates one review and updates it on a second submission', async () => {
    const seeded = await seed();

    const first = await submitDramaReview(
      seeded.userId,
      seeded.dramaId,
      'A slow burn',
      'The first version of the review.'
    );

    const second = await submitDramaReview(
      seeded.userId,
      seeded.dramaId,
      'Still a slow burn',
      'The second version of the review.'
    );

    expect(first?.id).toBe(second?.id);

    const rows = await db
      .select()
      .from(reviews)
      .where(
        and(eq(reviews.user_id, seeded.userId), eq(reviews.drama_id, seeded.dramaId))
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe('The second version of the review.');
    expect(rows[0]?.title).toBe('Still a slow burn');
  });

  it('preserves the creation time and stamps the last edit', async () => {
    const seeded = await seed();

    const created = await submitDramaReview(
      seeded.userId,
      seeded.dramaId,
      null,
      'The first version.'
    );

    expect(created).not.toBeNull();

    await new Promise(resolve => setTimeout(resolve, 20));

    const updated = await submitDramaReview(
      seeded.userId,
      seeded.dramaId,
      null,
      'The second version.'
    );

    expect(updated?.createdAt.getTime()).toBe(created?.createdAt.getTime());
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created?.updatedAt.getTime() ?? 0);
  });

  it('reads the viewer own review', async () => {
    const seeded = await seed();

    expect(await getUserReview(seeded.userId, 'drama', seeded.dramaId)).toBeNull();

    await submitDramaReview(seeded.userId, seeded.dramaId, 'Title', 'Body.');

    const own = await getUserReview(seeded.userId, 'drama', seeded.dramaId);

    expect(own?.content).toBe('Body.');
    expect(own?.title).toBe('Title');
  });

  it('writes a movie review', async () => {
    const seeded = await seed();

    await submitMovieReview(seeded.userId, seeded.movieId, null, 'A lovely film.');

    const listed = await listReviews('movie', seeded.movieId);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.content).toBe('A lovely film.');
  });
});

describe('listReviews', () => {
  it('orders by newest first', async () => {
    const seeded = await seed();

    await submitDramaReview(seeded.userId, seeded.dramaId, null, 'First review.');
    await new Promise(resolve => setTimeout(resolve, 20));
    await submitDramaReview(seeded.otherUserId, seeded.dramaId, null, 'Second review.');

    const listed = await listReviews('drama', seeded.dramaId, { sort: 'newest' });

    expect(listed.map(review => review.content)).toEqual([
      'Second review.',
      'First review.',
    ]);
  });

  it('orders by the number of enjoying reactions', async () => {
    const seeded = await seed();

    const first = await submitDramaReview(seeded.userId, seeded.dramaId, null, 'First review.');
    const second = await submitDramaReview(
      seeded.otherUserId,
      seeded.dramaId,
      null,
      'Second review.'
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    await toggleReviewEnjoying(second!.id, seeded.userId);

    const listed = await listReviews('drama', seeded.dramaId, { sort: 'most-enjoying' });

    expect(listed[0]?.content).toBe('Second review.');
    expect(listed[0]?.enjoyingCount).toBe(1);
  });

  it('orders by the rating the author gave the same content item', async () => {
    const seeded = await seed();

    await submitDramaReview(seeded.userId, seeded.dramaId, null, 'First review.');
    await submitDramaReview(seeded.otherUserId, seeded.dramaId, null, 'Second review.');

    await submitDramaRating(seeded.userId, seeded.dramaId, 2);
    await submitDramaRating(seeded.otherUserId, seeded.dramaId, 5);

    const listed = await listReviews('drama', seeded.dramaId, { sort: 'highest-rated' });

    expect(listed[0]?.content).toBe('Second review.');
    expect(listed[0]?.authorRating).toBe(5);
    expect(listed[1]?.authorRating).toBe(2);
  });

  it('marks the reaction of the signed-in viewer', async () => {
    const seeded = await seed();

    const review = await submitDramaReview(seeded.userId, seeded.dramaId, null, 'A review.');

    expect(review).not.toBeNull();

    await toggleReviewEnjoying(review!.id, seeded.otherUserId);

    const listed = await listReviews('drama', seeded.dramaId, { viewerId: seeded.otherUserId });

    expect(listed[0]?.reactedByViewer).toBe(true);
  });
});

describe('toggleReviewEnjoying', () => {
  it('adds a reaction and removes it again', async () => {
    const seeded = await seed();

    const review = await submitDramaReview(seeded.userId, seeded.dramaId, null, 'A review.');

    expect(review).not.toBeNull();

    const added = await toggleReviewEnjoying(review!.id, seeded.otherUserId);

    expect(added.enjoying).toBe(true);
    expect(added.count).toBe(1);
    expect(await getReviewEnjoyingCount(review!.id)).toBe(1);

    const removed = await toggleReviewEnjoying(review!.id, seeded.otherUserId);

    expect(removed.enjoying).toBe(false);
    expect(removed.count).toBe(0);
    expect(await getReviewEnjoyingCount(review!.id)).toBe(0);
  });

  it('keeps one reaction per viewer per review', async () => {
    const seeded = await seed();

    const review = await submitDramaReview(seeded.userId, seeded.dramaId, null, 'A review.');

    expect(review).not.toBeNull();

    await toggleReviewEnjoying(review!.id, seeded.otherUserId);

    const rows = await db
      .select()
      .from(review_reactions)
      .where(eq(review_reactions.review_id, review!.id));

    expect(rows).toHaveLength(1);
  });
});

describe('submitReviewReport', () => {
  it('keeps one active report per viewer per review', async () => {
    const seeded = await seed();

    const review = await submitDramaReview(seeded.userId, seeded.dramaId, null, 'A review.');

    expect(review).not.toBeNull();

    await submitReviewReport(seeded.otherUserId, review!.id, 'spam_advertising', 'First report.');
    const second = await submitReviewReport(
      seeded.otherUserId,
      review!.id,
      'other',
      'Updated report.'
    );

    const rows = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.review_id, review!.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('other');
    expect(rows[0]?.description).toBe('Updated report.');
    expect(second?.id).toBe(rows[0]?.id);
  });

  it('lets a viewer report again after the earlier report was resolved', async () => {
    const seeded = await seed();

    const review = await submitDramaReview(seeded.userId, seeded.dramaId, null, 'A review.');

    expect(review).not.toBeNull();

    const first = await submitReviewReport(seeded.otherUserId, review!.id, 'other', null);

    expect(first).not.toBeNull();

    await resolveReviewReport(first!.id, 'The review was kept.', seeded.userId);

    const second = await submitReviewReport(
      seeded.otherUserId,
      review!.id,
      'harassment_bullying',
      null
    );

    expect(second?.id).not.toBe(first?.id);

    const rows = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.review_id, review!.id));

    expect(rows).toHaveLength(2);
  });

  it('lets several viewers report the same review', async () => {
    const seeded = await seed();

    const review = await submitDramaReview(seeded.userId, seeded.dramaId, null, 'A review.');

    expect(review).not.toBeNull();

    await submitReviewReport(seeded.otherUserId, review!.id, 'other', null);

    const rows = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.review_id, review!.id));

    expect(rows).toHaveLength(1);

    // A second, distinct reporter creates a second row.
    const thirdUserId = randomUUID();

    await db.insert(users).values({
      id: thirdUserId,
      name: 'Third reviewer',
      email: `${TEST_PREFIX}third-${randomUUID().slice(0, 8)}@example.com`,
    });

    await submitReviewReport(thirdUserId, review!.id, 'other', null);

    const afterRows = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.review_id, review!.id));

    expect(afterRows).toHaveLength(2);
  });

  it('records the outcome and the moderator when a report is resolved', async () => {
    const seeded = await seed();

    const review = await submitDramaReview(seeded.userId, seeded.dramaId, null, 'A review.');

    expect(review).not.toBeNull();

    const report = await submitReviewReport(seeded.otherUserId, review!.id, 'other', null);

    expect(report).not.toBeNull();

    const resolved = await resolveReviewReport(
      report!.id,
      'The review was removed.',
      seeded.userId
    );

    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolutionOutcome).toBe('The review was removed.');
    expect(resolved?.resolvedBy).toBe(seeded.userId);
    expect(resolved?.resolvedAt).not.toBeNull();
  });
});
