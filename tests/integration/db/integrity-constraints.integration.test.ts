import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the integrity constraints added by the Phase 4
 * migrations (H-08, H-09, M-07, SCOPE-D01).
 *
 * Every assertion writes through raw SQL instead of the workflow layer. The
 * workflows validate in application code, so a workflow-mediated test would pass
 * even when the database enforces nothing. These tests prove the guarantee the
 * schema claims: the database itself rejects the invalid row.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for integrity constraint tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { roles, userRoles } from '@/modules/authorization/schema';
import {
  categories,
  drama_categories as dramaCategories,
  dramas,
  episodes,
  movies,
  platforms,
  seasons,
  similar_dramas as similarDramas,
} from '@/modules/content/schema';
import {
  ratings,
  review_reactions as reviewReactions,
  review_reports as reviewReports,
  reviews,
} from '@/modules/reviews/schema';
import { bookmarks, playback_progress as playbackProgress } from '@/modules/users/schema';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-constraint-';

type PgError = { code?: string; constraint?: string };

const created = {
  dramas: [] as string[],
  movies: [] as string[],
  users: [] as string[],
  categories: [] as string[],
  platforms: [] as string[],
};

/**
 * Resolve a rejected statement into its PostgreSQL error.
 *
 * A constraint test has to distinguish "the database rejected this" from "the
 * query never ran", so the SQLSTATE is asserted rather than the rejection alone.
 * Drizzle wraps driver failures, so the SQLSTATE is read from the cause chain
 * instead of only the outermost error object.
 */
async function rejectionOf(run: Promise<unknown>): Promise<PgError> {
  try {
    await run;
  } catch (error) {
    let current = error as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;

    while (current) {
      if (typeof current.code === 'string') {
        return {
          code: current.code,
          constraint: typeof current.constraint === 'string' ? current.constraint : undefined,
        };
      }

      current = current.cause as typeof current;
    }

    return {};
  }

  throw new Error('Expected the database to reject the statement, but it succeeded.');
}

async function seedDrama(label: string): Promise<string> {
  const [row] = await db
    .insert(dramas)
    .values({
      title: `Constraint Drama ${label}`,
      slug: `${TEST_PREFIX}${label}-${randomUUID().slice(0, 8)}`,
    })
    .returning({ id: dramas.id });

  created.dramas.push(row!.id);

  return row!.id;
}

async function seedMovie(label: string): Promise<string> {
  const [row] = await db
    .insert(movies)
    .values({
      title: `Constraint Movie ${label}`,
      slug: `${TEST_PREFIX}${label}-${randomUUID().slice(0, 8)}`,
    })
    .returning({ id: movies.id });

  created.movies.push(row!.id);

  return row!.id;
}

async function seedUser(label: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name: `Constraint User ${label}`,
      email: `${TEST_PREFIX}${label}-${randomUUID()}@example.com`,
    })
    .returning({ id: users.id });

  created.users.push(row!.id);

  return row!.id;
}

async function seedSeason(dramaId: string, label: string, position: number): Promise<string> {
  const [row] = await db
    .insert(seasons)
    .values({ drama_id: dramaId, title: `Season ${label}`, position })
    .returning({ id: seasons.id });

  return row!.id;
}

async function seedEpisode(
  dramaId: string,
  label: string,
  values: { episode_number?: number | null; season_id?: string | null } = {}
): Promise<string> {
  const [row] = await db
    .insert(episodes)
    .values({
      drama_id: dramaId,
      season_id: values.season_id ?? null,
      title: `Episode ${label}`,
      episode_number: values.episode_number ?? null,
    })
    .returning({ id: episodes.id });

  return row!.id;
}

async function seedReview(userId: string, dramaId: string): Promise<string> {
  const [row] = await db
    .insert(reviews)
    .values({ user_id: userId, drama_id: dramaId, content: 'A review body.' })
    .returning({ id: reviews.id });

  return row!.id;
}

/**
 * Date used by the site-wide aggregate fixture.
 *
 * It is deliberately unlike any other date in the suite so the cleanup can
 * remove exactly its own rows instead of every targetless aggregate row.
 */
const SITE_WIDE_AGGREGATE_DATE = '2026-03-17';

async function cleanup(): Promise<void> {
  // Analytics rows reference content through a `restrict` foreign key, so they
  // are removed before the content they point at.
  for (const dramaId of created.dramas) {
    await db.execute(sql`DELETE FROM content_view_events WHERE content_id = ${dramaId}`);
    await db.execute(sql`DELETE FROM playback_analytics_events WHERE content_id = ${dramaId}`);
    await db.execute(sql`DELETE FROM analytics_daily_aggregates WHERE content_id = ${dramaId}`);
  }

  for (const movieId of created.movies) {
    await db.execute(sql`DELETE FROM content_view_events WHERE content_id = ${movieId}`);
    await db.execute(sql`DELETE FROM playback_analytics_events WHERE content_id = ${movieId}`);
    await db.execute(sql`DELETE FROM analytics_daily_aggregates WHERE content_id = ${movieId}`);
  }

  await db.execute(
    sql`DELETE FROM analytics_daily_aggregates WHERE content_id IS NULL AND date = ${SITE_WIDE_AGGREGATE_DATE}`
  );

  if (created.users.length > 0) {
    const userIds = created.users;

    await db.delete(reviewReports).where(inArray(reviewReports.user_id, userIds));
    await db.delete(reviewReactions).where(inArray(reviewReactions.user_id, userIds));
    await db.delete(ratings).where(inArray(ratings.user_id, userIds));
    await db.delete(reviews).where(inArray(reviews.user_id, userIds));
    await db.delete(bookmarks).where(inArray(bookmarks.user_id, userIds));
    await db.delete(playbackProgress).where(inArray(playbackProgress.user_id, userIds));
    await db.delete(userRoles).where(inArray(userRoles.user_id, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }

  for (const dramaId of created.dramas) {
    await db.delete(similarDramas).where(eq(similarDramas.drama_id, dramaId));
    await db.delete(dramaCategories).where(eq(dramaCategories.drama_id, dramaId));
    await db.delete(episodes).where(eq(episodes.drama_id, dramaId));
    await db.delete(seasons).where(eq(seasons.drama_id, dramaId));
    await db.delete(dramas).where(eq(dramas.id, dramaId));
  }

  for (const movieId of created.movies) {
    await db.delete(movies).where(eq(movies.id, movieId));
  }

  if (created.categories.length > 0) {
    await db.delete(categories).where(inArray(categories.id, created.categories));
  }

  if (created.platforms.length > 0) {
    await db.delete(platforms).where(inArray(platforms.id, created.platforms));
  }

  created.dramas.length = 0;
  created.movies.length = 0;
  created.users.length = 0;
  created.categories.length = 0;
  created.platforms.length = 0;
}

beforeEach(cleanup);
afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('content hierarchy foreign keys (H-08)', () => {
  it('rejects a season whose drama does not exist', async () => {
    const error = await rejectionOf(
      db.insert(seasons).values({
        drama_id: '00000000-0000-7000-8000-000000000000',
        title: 'Orphan Season',
      })
    );

    expect(error.code).toBe('23503');
  });

  it('rejects an episode whose drama does not exist', async () => {
    const error = await rejectionOf(
      db.insert(episodes).values({
        drama_id: '00000000-0000-7000-8000-000000000000',
        title: 'Orphan Episode',
      })
    );

    expect(error.code).toBe('23503');
  });

  it('rejects an episode that names a season belonging to another drama', async () => {
    const ownDrama = await seedDrama('cross-own');
    const otherDrama = await seedDrama('cross-other');
    const foreignSeason = await seedSeason(otherDrama, 'Foreign', 0);

    // The application guards this, but one missed guard would create an episode
    // whose season contradicts its drama. The composite foreign key makes the
    // disagreement impossible at the storage layer.
    const error = await rejectionOf(
      db.insert(episodes).values({
        drama_id: ownDrama,
        season_id: foreignSeason,
        title: 'Conflicted Episode',
      })
    );

    expect(error.code).toBe('23503');
  });

  it('accepts an episode with no season and a valid drama', async () => {
    const dramaId = await seedDrama('no-season');

    await expect(seedEpisode(dramaId, 'unseasoned')).resolves.toEqual(expect.any(String));
  });

  it('rejects a category link whose category does not exist', async () => {
    const dramaId = await seedDrama('bad-category');

    const error = await rejectionOf(
      db.insert(dramaCategories).values({
        drama_id: dramaId,
        category_id: '00000000-0000-7000-8000-000000000000',
      })
    );

    expect(error.code).toBe('23503');
  });

  it('rejects a similar-drama link whose target does not exist', async () => {
    const dramaId = await seedDrama('bad-similar');

    const error = await rejectionOf(
      db.insert(similarDramas).values({
        drama_id: dramaId,
        similar_drama_id: '00000000-0000-7000-8000-000000000000',
      })
    );

    expect(error.code).toBe('23503');
  });

  it('rejects a role assignment for a user that does not exist', async () => {
    // The role is created here rather than read from the seed, so the assertion
    // does not depend on baseline data the test database may not contain.
    const [role] = await db
      .insert(roles)
      .values({ name: `${TEST_PREFIX}role-${randomUUID().slice(0, 8)}` })
      .returning({ id: roles.id });

    const error = await rejectionOf(
      db.insert(userRoles).values({
        user_id: '00000000-0000-7000-8000-000000000000',
        role_id: role!.id,
      })
    );

    expect(error.code).toBe('23503');

    await db.delete(roles).where(eq(roles.id, role!.id));
  });
});

describe('scoped uniqueness (H-08)', () => {
  it('rejects a duplicate active episode number inside one drama', async () => {
    const dramaId = await seedDrama('dup-number');
    await seedEpisode(dramaId, 'first', { episode_number: 4 });

    const error = await rejectionOf(seedEpisode(dramaId, 'second', { episode_number: 4 }));

    expect(error.code).toBe('23505');
  });

  it('allows the same episode number in a different drama', async () => {
    const firstDrama = await seedDrama('dup-scope-a');
    const secondDrama = await seedDrama('dup-scope-b');

    await seedEpisode(firstDrama, 'first', { episode_number: 4 });

    await expect(seedEpisode(secondDrama, 'second', { episode_number: 4 })).resolves.toEqual(
      expect.any(String)
    );
  });

  it('does not let a trashed episode block its number from being reused', async () => {
    const dramaId = await seedDrama('dup-trashed');
    const trashed = await seedEpisode(dramaId, 'trashed', { episode_number: 6 });

    await db.update(episodes).set({ deleted_at: new Date() }).where(eq(episodes.id, trashed));

    await expect(seedEpisode(dramaId, 'replacement', { episode_number: 6 })).resolves.toEqual(
      expect.any(String)
    );
  });

  it('rejects a duplicate active season position inside one drama', async () => {
    const dramaId = await seedDrama('dup-position');
    await seedSeason(dramaId, 'first', 2);

    const error = await rejectionOf(seedSeason(dramaId, 'second', 2));

    expect(error.code).toBe('23505');
  });

  it('rejects a duplicate active category slug', async () => {
    const slug = `${TEST_PREFIX}cat-${randomUUID().slice(0, 8)}`;
    const [row] = await db
      .insert(categories)
      .values({ name: 'First Category', slug })
      .returning({ id: categories.id });

    created.categories.push(row!.id);

    const error = await rejectionOf(
      db.insert(categories).values({ name: 'Second Category', slug })
    );

    expect(error.code).toBe('23505');
  });

  it('rejects a duplicate active drama slug', async () => {
    const dramaId = await seedDrama('dup-slug');
    const [row] = await db.select({ slug: dramas.slug }).from(dramas).where(eq(dramas.id, dramaId));

    const error = await rejectionOf(
      db.insert(dramas).values({ title: 'Duplicate Slug', slug: row!.slug })
    );

    expect(error.code).toBe('23505');
  });

  it('allows a trashed category to keep the slug of a new active one', async () => {
    const slug = `${TEST_PREFIX}cat-reuse-${randomUUID().slice(0, 8)}`;
    const [trashed] = await db
      .insert(categories)
      .values({ name: 'Trashed Category', slug, deleted_at: new Date() })
      .returning({ id: categories.id });

    created.categories.push(trashed!.id);

    // The active category is registered too, so the cleanup removes the row
    // this test creates instead of leaving it behind.
    const [active] = await db
      .insert(categories)
      .values({ name: 'Active Category', slug })
      .returning({ id: categories.id });

    created.categories.push(active!.id);
  });

  it('rejects a duplicate active platform slug', async () => {
    const slug = `${TEST_PREFIX}plat-${randomUUID().slice(0, 8)}`;
    const [row] = await db
      .insert(platforms)
      .values({ name: 'First Platform', slug })
      .returning({ id: platforms.id });

    created.platforms.push(row!.id);

    const error = await rejectionOf(db.insert(platforms).values({ name: 'Second', slug }));

    expect(error.code).toBe('23505');
  });
});

describe('rating and review constraints (M-07)', () => {
  it.each([0, 6, -1])('rejects the out-of-range rating value %s', async value => {
    const userId = await seedUser(`rating-${value}`);
    const dramaId = await seedDrama(`rating-${value}`);

    const error = await rejectionOf(
      db.insert(ratings).values({ user_id: userId, drama_id: dramaId, value })
    );

    expect(error.code).toBe('23514');
  });

  it.each([1, 5])('accepts the boundary rating value %s', async value => {
    const userId = await seedUser(`rating-ok-${value}`);
    const dramaId = await seedDrama(`rating-ok-${value}`);

    await expect(
      db.insert(ratings).values({ user_id: userId, drama_id: dramaId, value })
    ).resolves.toBeDefined();
  });

  it('rejects a reaction that points at no review', async () => {
    const userId = await seedUser('reaction-orphan');

    const error = await rejectionOf(
      db.insert(reviewReactions).values({
        user_id: userId,
        review_id: '00000000-0000-7000-8000-000000000000',
      })
    );

    expect(error.code).toBe('23503');
  });

  it('rejects a second reaction from the same user on the same review', async () => {
    const userId = await seedUser('reaction-dup');
    const dramaId = await seedDrama('reaction-dup');
    const reviewId = await seedReview(userId, dramaId);

    await db.insert(reviewReactions).values({ user_id: userId, review_id: reviewId });

    const error = await rejectionOf(
      db.insert(reviewReactions).values({ user_id: userId, review_id: reviewId })
    );

    expect(error.code).toBe('23505');
  });

  it('opens a new report in the active state', async () => {
    const userId = await seedUser('report-default');
    const dramaId = await seedDrama('report-default');
    const reviewId = await seedReview(userId, dramaId);

    const [row] = await db
      .insert(reviewReports)
      .values({ user_id: userId, review_id: reviewId, reason: 'Spam' })
      .returning({ status: reviewReports.status, resolvedAt: reviewReports.resolved_at });

    expect(row).toMatchObject({ status: 'active', resolvedAt: null });
  });

  it('rejects a second active report but allows a new one after resolution', async () => {
    const userId = await seedUser('report-dup');
    const dramaId = await seedDrama('report-dup');
    const reviewId = await seedReview(userId, dramaId);

    const [first] = await db
      .insert(reviewReports)
      .values({ user_id: userId, review_id: reviewId, reason: 'Spam' })
      .returning({ id: reviewReports.id });

    const duplicateError = await rejectionOf(
      db.insert(reviewReports).values({ user_id: userId, review_id: reviewId, reason: 'Again' })
    );

    expect(duplicateError.code).toBe('23505');

    // A resolution is a complete record: the moderator, the outcome, and the
    // instant all belong to it.
    await db
      .update(reviewReports)
      .set({
        status: 'resolved',
        resolved_at: new Date(),
        resolved_by: await seedUser('report-resolver'),
        resolution_outcome: 'removed',
      })
      .where(eq(reviewReports.id, first!.id));

    await expect(
      db.insert(reviewReports).values({ user_id: userId, review_id: reviewId, reason: 'New issue' })
    ).resolves.toBeDefined();
  });

  it('rejects a report status outside the lifecycle vocabulary', async () => {
    const userId = await seedUser('report-status');
    const dramaId = await seedDrama('report-status');
    const reviewId = await seedReview(userId, dramaId);

    const error = await rejectionOf(
      db.insert(reviewReports).values({
        user_id: userId,
        review_id: reviewId,
        reason: 'Spam',
        status: 'archived',
      })
    );

    expect(error.code).toBe('23514');
  });
});

describe('typed user-content targets (H-09)', () => {
  it('rejects a bookmark with no typed target', async () => {
    const userId = await seedUser('bookmark-empty');

    const error = await rejectionOf(
      db.insert(bookmarks).values({
        user_id: userId,
        content_type: 'drama',
        content_id: randomUUID(),
      })
    );

    expect(error.code).toBe('23514');
  });

  it('rejects a bookmark that targets both a drama and a movie', async () => {
    const userId = await seedUser('bookmark-both');
    const dramaId = await seedDrama('bookmark-both');
    const movieId = await seedMovie('bookmark-both');

    const error = await rejectionOf(
      db.insert(bookmarks).values({
        user_id: userId,
        content_type: 'drama',
        content_id: dramaId,
        drama_id: dramaId,
        movie_id: movieId,
      })
    );

    expect(error.code).toBe('23514');
  });

  it('rejects a bookmark whose typed drama does not exist', async () => {
    const userId = await seedUser('bookmark-ghost');

    const error = await rejectionOf(
      db.insert(bookmarks).values({
        user_id: userId,
        content_type: 'drama',
        content_id: randomUUID(),
        drama_id: '00000000-0000-7000-8000-000000000000',
      })
    );

    expect(error.code).toBe('23503');
  });

  it('accepts a bookmark with exactly one existing typed target', async () => {
    const userId = await seedUser('bookmark-ok');
    const movieId = await seedMovie('bookmark-ok');

    await expect(
      db.insert(bookmarks).values({
        user_id: userId,
        content_type: 'movie',
        content_id: movieId,
        movie_id: movieId,
      })
    ).resolves.toBeDefined();
  });

  it('rejects a second progress record for the same user and episode', async () => {
    const userId = await seedUser('progress-dup');
    const dramaId = await seedDrama('progress-dup');
    const episodeId = await seedEpisode(dramaId, 'progress', { episode_number: 1 });

    await db.insert(playbackProgress).values({
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: episodeId,
    });

    const error = await rejectionOf(
      db.insert(playbackProgress).values({
        user_id: userId,
        content_type: 'drama',
        content_id: dramaId,
        drama_id: dramaId,
        episode_id: episodeId,
      })
    );

    expect(error.code).toBe('23505');
  });

  it('rejects progress that points at an episode that does not exist', async () => {
    const userId = await seedUser('progress-orphan');
    const dramaId = await seedDrama('progress-orphan');

    const error = await rejectionOf(
      db.insert(playbackProgress).values({
        user_id: userId,
        content_type: 'drama',
        content_id: dramaId,
        drama_id: dramaId,
        episode_id: '00000000-0000-7000-8000-000000000000',
      })
    );

    expect(error.code).toBe('23503');
  });
});

describe('analytics typed targets (H-09)', () => {
  it('rejects a view event with no typed target', async () => {
    const dramaId = await seedDrama('view-empty');

    const error = await rejectionOf(
      db.execute(
        sql`INSERT INTO content_view_events (content_type, content_id) VALUES ('drama', ${dramaId})`
      )
    );

    expect(error.code).toBe('23514');
  });

  it('rejects a view event that targets both a drama and a movie', async () => {
    const dramaId = await seedDrama('view-both');
    const movieId = await seedMovie('view-both');

    const error = await rejectionOf(
      db.execute(
        sql`INSERT INTO content_view_events (content_type, content_id, drama_id, movie_id)
            VALUES ('drama', ${dramaId}, ${dramaId}, ${movieId})`
      )
    );

    expect(error.code).toBe('23514');
  });

  it('rejects a view event whose typed drama does not exist', async () => {
    const ghost = '00000000-0000-7000-8000-000000000000';

    const error = await rejectionOf(
      db.execute(
        sql`INSERT INTO content_view_events (content_type, content_id, drama_id)
            VALUES ('drama', ${ghost}, ${ghost})`
      )
    );

    expect(error.code).toBe('23503');
  });

  it('accepts a view event with exactly one existing typed target', async () => {
    const movieId = await seedMovie('view-ok');

    await expect(
      db.execute(
        sql`INSERT INTO content_view_events (content_type, content_id, movie_id)
            VALUES ('movie', ${movieId}, ${movieId})`
      )
    ).resolves.toBeDefined();
  });

  it('rejects a playback event with no typed target', async () => {
    const dramaId = await seedDrama('playback-empty');

    const error = await rejectionOf(
      db.execute(
        sql`INSERT INTO playback_analytics_events (content_type, content_id, event_type)
            VALUES ('drama', ${dramaId}, 'play_pause')`
      )
    );

    expect(error.code).toBe('23514');
  });

  it('allows a site-wide daily aggregate with no typed target', async () => {
    // A site-wide aggregate legitimately has no content target, so the
    // aggregate table allows both typed columns to stay null.
    await expect(
      db.execute(
        sql`INSERT INTO analytics_daily_aggregates (date, total_views)
            VALUES (${SITE_WIDE_AGGREGATE_DATE}, 4)`
      )
    ).resolves.toBeDefined();
  });

  it('rejects a daily aggregate that targets both a drama and a movie', async () => {
    const dramaId = await seedDrama('aggregate-both');
    const movieId = await seedMovie('aggregate-both');

    const error = await rejectionOf(
      db.execute(
        sql`INSERT INTO analytics_daily_aggregates (date, content_type, content_id, drama_id, movie_id)
            VALUES (${SITE_WIDE_AGGREGATE_DATE}, 'drama', ${dramaId}, ${dramaId}, ${movieId})`
      )
    );

    expect(error.code).toBe('23514');
  });
});

describe('review report state (M-07)', () => {
  it('stamps a new report with its submission time and no resolution record', async () => {
    const userId = await seedUser('report-stamp');
    const dramaId = await seedDrama('report-stamp');
    const reviewId = await seedReview(userId, dramaId);

    const rows = await db.execute<{ reported_at: string | null; description: string | null }>(
      sql`INSERT INTO review_reports (user_id, review_id, reason)
          VALUES (${userId}, ${reviewId}, 'Spam')
          RETURNING reported_at::text, description`
    );

    expect(rows.rows[0]?.reported_at).not.toBeNull();
    expect(rows.rows[0]?.description).toBeNull();
  });

  it('rejects an active report that carries a resolution record', async () => {
    const userId = await seedUser('report-active-resolved');
    const dramaId = await seedDrama('report-active-resolved');
    const reviewId = await seedReview(userId, dramaId);

    const error = await rejectionOf(
      db.execute(
        sql`INSERT INTO review_reports (user_id, review_id, reason, resolved_at)
            VALUES (${userId}, ${reviewId}, 'Spam', now())`
      )
    );

    expect(error.code).toBe('23514');
  });

  it.each([
    ['resolved_at', 'resolved_at'],
    ['resolved_by', 'resolved_by'],
    ['resolution_outcome', 'resolution_outcome'],
  ])('rejects a resolved report that is missing %s', async (_label, column) => {
    const userId = await seedUser(`report-resolved-${_label}`);
    const dramaId = await seedDrama(`report-resolved-${_label}`);
    const reviewId = await seedReview(userId, dramaId);

    const error = await rejectionOf(
      db.execute(
        sql`INSERT INTO review_reports (user_id, review_id, reason, status, ${sql.raw(column)})
            VALUES (${userId}, ${reviewId}, 'Spam', 'resolved', NULL)`
      )
    );

    expect(error.code).toBe('23514');
  });

  it('accepts a resolved report with a complete resolution record', async () => {
    const userId = await seedUser('report-resolved-ok');
    const dramaId = await seedDrama('report-resolved-ok');
    const reviewId = await seedReview(userId, dramaId);
    const resolverId = await seedUser('report-resolver');

    await expect(
      db.execute(
        sql`INSERT INTO review_reports
              (user_id, review_id, reason, description, status, resolved_at, resolved_by, resolution_outcome)
            VALUES (${userId}, ${reviewId}, 'Spam', 'Repeated advertising links.', 'resolved', now(), ${resolverId}, 'removed')`
      )
    ).resolves.toBeDefined();
  });

  it('rejects a resolver that is not a user', async () => {
    const userId = await seedUser('report-resolver-ghost');
    const dramaId = await seedDrama('report-resolver-ghost');
    const reviewId = await seedReview(userId, dramaId);

    const error = await rejectionOf(
      db.execute(
        sql`INSERT INTO review_reports
              (user_id, review_id, reason, status, resolved_at, resolved_by, resolution_outcome)
            VALUES (${userId}, ${reviewId}, 'Spam', 'resolved', now(), ${'00000000-0000-7000-8000-000000000000'}, 'removed')`
      )
    );

    expect(error.code).toBe('23503');
  });

  it('blocks the permanent removal of a review that has reports', async () => {
    const userId = await seedUser('report-keep-history');
    const dramaId = await seedDrama('report-keep-history');
    const reviewId = await seedReview(userId, dramaId);

    await db.insert(reviewReports).values({ user_id: userId, review_id: reviewId, reason: 'Spam' });

    const error = await rejectionOf(db.delete(reviews).where(eq(reviews.id, reviewId)));

    // `ON DELETE RESTRICT` raises `restrict_violation` (23001); the delete is
    // refused either way, which is the point of the constraint.
    expect(error.code).toBe('23001');

    // The report itself survives the blocked deletion.
    expect(
      await db.select().from(reviewReports).where(eq(reviewReports.review_id, reviewId))
    ).toHaveLength(1);
  });
});

describe('published_at columns (SCOPE-D01)', () => {
  it('adds a nullable timestamptz column to every publishable content table', async () => {
    const rows = await db.execute<{ table_name: string; data_type: string; is_nullable: string }>(
      sql`SELECT table_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name = 'published_at'
            AND table_name IN ('dramas', 'seasons', 'episodes', 'movies')
          ORDER BY table_name`
    );

    expect(rows.rows).toEqual([
      { table_name: 'dramas', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { table_name: 'episodes', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { table_name: 'movies', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { table_name: 'seasons', data_type: 'timestamp with time zone', is_nullable: 'YES' },
    ]);
  });

  it('leaves the column null when a drama is created without a publication event', async () => {
    const dramaId = await seedDrama('null-published');

    const [row] = await db
      .select({ publishedAt: dramas.published_at })
      .from(dramas)
      .where(eq(dramas.id, dramaId));

    expect(row?.publishedAt).toBeNull();
  });

  it('does not fabricate a date for a row that was already published', async () => {
    const slug = `${TEST_PREFIX}legacy-published-${randomUUID().slice(0, 8)}`;
    const [row] = await db
      .insert(dramas)
      .values({ title: 'Legacy Published', slug, publication_status: 'published' })
      .returning({ id: dramas.id, publishedAt: dramas.published_at });

    created.dramas.push(row!.id);

    expect(row?.publishedAt).toBeNull();
  });
});

describe('constraint presence guards against silent migration loss', () => {
  it('registers every Phase 4 constraint in the catalogue', async () => {
    const expected = [
      'fk_seasons_drama_id',
      'fk_episodes_drama_id',
      'fk_episodes_drama_id_season_id',
      'fk_drama_categories_drama_id',
      'fk_drama_categories_category_id',
      'fk_drama_platforms_drama_id',
      'fk_drama_platforms_platform_id',
      'fk_movie_categories_movie_id',
      'fk_movie_categories_category_id',
      'fk_movie_platforms_movie_id',
      'fk_movie_platforms_platform_id',
      'fk_similar_dramas_drama_id',
      'fk_similar_dramas_similar_drama_id',
      'fk_user_roles_user_id',
      'ck_ratings_value_range',
      'fk_review_reactions_user_id',
      'fk_review_reactions_review_id',
      'fk_review_reports_user_id',
      'fk_review_reports_review_id',
      'ck_review_reports_status',
      'ck_bookmarks_target',
      'ck_playback_progress_target',
      'ck_watched_state_target',
      'ck_watch_history_target',
      'ck_content_view_events_target',
      'ck_playback_analytics_events_target',
      'ck_analytics_daily_aggregates_target',
      'fk_content_view_events_drama_id',
      'fk_content_view_events_movie_id',
      'fk_playback_analytics_events_drama_id',
      'fk_playback_analytics_events_movie_id',
      'fk_analytics_daily_aggregates_drama_id',
      'fk_analytics_daily_aggregates_movie_id',
      'fk_review_reports_resolved_by',
      'ck_review_reports_lifecycle',
    ];

    const rows = await db.execute<{ conname: string }>(
      sql`SELECT conname FROM pg_constraint
           WHERE connamespace = current_schema()::regnamespace
             AND conname = ANY(${sql.raw(
               `ARRAY[${expected.map(name => `'${name}'`).join(',')}]::text[]`
             )})`
    );

    expect(rows.rows.map(row => row.conname).sort()).toEqual([...expected].sort());
  });

  it('registers the scoped unique indexes the workflows rely on', async () => {
    const expected = [
      'uq_episodes_drama_id_episode_number_active',
      'uq_seasons_drama_id_position_active',
      'uq_dramas_slug_active',
      'uq_categories_slug_active',
      'uq_platforms_slug_active',
      'uq_review_reactions_user_id_review_id',
      'uq_review_reports_user_id_review_id_active',
      'uq_bookmarks_user_id_drama_id',
      'uq_bookmarks_user_id_movie_id',
      'uq_playback_progress_user_id_episode_id',
      'uq_playback_progress_user_id_movie_id',
    ];

    const rows = await db.execute<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes
           WHERE schemaname = current_schema()
             AND indexname = ANY(${sql.raw(
               `ARRAY[${expected.map(name => `'${name}'`).join(',')}]::text[]`
             )})`
    );

    expect(rows.rows.map(row => row.indexname).sort()).toEqual([...expected].sort());
  });
});
