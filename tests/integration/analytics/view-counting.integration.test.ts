import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * View-counting integration coverage (Prompts 139, 140).
 *
 * A view is counted once per visitor per content item in a rolling six-hour
 * window (D-002). The visitor is the anonymous guest session for a guest and
 * the account for a signed-in viewer; the event row carries only the
 * `guest_sessions` row id, so no personal identifier reaches the event table.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for view-counting integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, isNull } from 'drizzle-orm';
import { Client } from 'pg';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, movies } from '@/modules/content/schema';
import { content_view_events, guest_sessions } from '@/modules/analytics/schema';
import {
  recordContentView,
  viewWindowLockKey,
} from '@/modules/analytics/view-counting-workflow';
import { getContentViewCount } from '@/modules/analytics/view-counts';
import { resolveAnalyticsVisitor } from '@/modules/analytics/visitor';
import { closePool } from '@/platform/db/pool';

import { cleanupAnalyticsFixtures } from './support/cleanup';

const TEST_PREFIX = 'it-view-count-';

type Seed = {
  userId: string;
  dramaId: string;
  movieId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const dramaId = randomUUID();
  const movieId = randomUUID();

  await db.insert(users).values({
    id: userId,
    name: 'View counter',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'View counting drama',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    structure_type: 'season_based',
    status: 'ongoing',
    publication_status: 'published',
    visibility: 'coming_soon',
  });

  await db.insert(movies).values({
    id: movieId,
    title: 'View counting movie',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/1.mp4',
  });

  return { userId, dramaId, movieId };
}

async function countViews(contentId: string): Promise<number> {
  const rows = await db
    .select({ id: content_view_events.id })
    .from(content_view_events)
    .where(
      and(
        eq(content_view_events.content_id, contentId),
        isNull(content_view_events.deleted_at)
      )
    );

  return rows.length;
}

describe('view counting', () => {
  let seeded: Seed;

  beforeEach(async () => {
    await cleanupAnalyticsFixtures(TEST_PREFIX);
    seeded = await seed();
  });

  afterEach(async () => {
    await db
      .delete(content_view_events)
      .where(eq(content_view_events.content_id, seeded.dramaId));
    await db.delete(content_view_events).where(eq(content_view_events.content_id, seeded.movieId));
    await db.delete(guest_sessions).where(eq(guest_sessions.user_id, seeded.userId));
    await db
      .delete(guest_sessions)
      .where(eq(guest_sessions.session_id, `session-${seeded.userId}`));
    await cleanupAnalyticsFixtures(TEST_PREFIX);
  });

  it('counts a view whose typed target disagrees with its legacy pair under the typed target', async () => {
    // The typed foreign key is the evidence: the row belongs to the drama it
    // names, whatever its legacy pair says (D-032 §4, D-082).
    const sessionId = `session-${seeded.userId}`;
    const visitor = await resolveAnalyticsVisitor({ userId: null, sessionId });

    await db.insert(content_view_events).values({
      guest_session_id: visitor.guestSessionId,
      viewer_type: 'guest',
      content_id: seeded.movieId,
      content_type: 'movie',
      drama_id: seeded.dramaId,
      movie_id: null,
      viewed_at: new Date(),
      viewed_hour_bucket: '2026-01-01T00',
    });

    expect(await getContentViewCount('drama', seeded.dramaId)).toBe(1);
    expect(await getContentViewCount('movie', seeded.movieId)).toBe(0);
  });

  it('does not count a second view of the title a disagreeing row names', async () => {
    const sessionId = `session-${seeded.userId}`;
    const visitor = await resolveAnalyticsVisitor({ userId: null, sessionId });

    await db.insert(content_view_events).values({
      guest_session_id: visitor.guestSessionId,
      viewer_type: 'guest',
      content_id: seeded.movieId,
      content_type: 'movie',
      drama_id: seeded.dramaId,
      movie_id: null,
      viewed_at: new Date(),
      viewed_hour_bucket: '2026-01-01T00',
    });

    const result = await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
    });

    expect(result.counted).toBe(false);
    expect(result.alreadyCounted).toBe(true);
  });

  it('waits for the view it is racing with instead of counting a second one', async () => {
    // The window check and the insert are serialized per visitor and title, so
    // two requests that arrive at the same time produce one row (D-058).
    const sessionId = `session-${seeded.userId}`;
    const visitor = await resolveAnalyticsVisitor({ userId: null, sessionId });
    const client = new Client({ connectionString: process.env.DATABASE_URL });

    await client.connect();

    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        viewWindowLockKey(visitor.guestSessionId, 'drama', seeded.dramaId),
      ]);

      let settled = false;
      const pending = recordContentView({
        type: 'drama',
        contentId: seeded.dramaId,
        userId: null,
        sessionId,
      }).then(result => {
        settled = true;
        return result;
      });

      await new Promise(resolve => setTimeout(resolve, 250));

      expect(settled).toBe(false);

      await client.query('rollback');

      const result = await pending;

      expect(result.counted).toBe(true);
    } finally {
      await client.end();
    }
  });

  it('counts one view when two requests arrive at the same time', async () => {
    const sessionId = `session-${seeded.userId}`;

    // The visitor row exists before the requests arrive: a request that has to
    // create it waits for the row anyway, which would hide the race.
    await resolveAnalyticsVisitor({ userId: null, sessionId });

    const results = await Promise.all([
      recordContentView({
        type: 'drama',
        contentId: seeded.dramaId,
        userId: null,
        sessionId,
        now: new Date('2026-11-26T10:59:59.000Z'),
      }),
      recordContentView({
        type: 'drama',
        contentId: seeded.dramaId,
        userId: null,
        sessionId,
        now: new Date('2026-11-26T11:00:01.000Z'),
      }),
      recordContentView({
        type: 'drama',
        contentId: seeded.dramaId,
        userId: null,
        sessionId,
        now: new Date('2026-11-26T11:00:02.000Z'),
      }),
      recordContentView({
        type: 'drama',
        contentId: seeded.dramaId,
        userId: null,
        sessionId,
        now: new Date('2026-11-26T11:00:03.000Z'),
      }),
    ]);

    expect(results.filter(result => result.counted)).toHaveLength(1);
  });

  it('counts the first view of a drama', async () => {
    const result = await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
    });

    expect(result.counted).toBe(true);
    expect(result.alreadyCounted).toBe(false);
    expect(await countViews(seeded.dramaId)).toBe(1);
  });

  it('does not count a second view of the same drama by the same visitor', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    const first = await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
    });
    const second = await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
    });

    expect(first.counted).toBe(true);
    expect(second.counted).toBe(false);
    expect(second.alreadyCounted).toBe(true);
    expect(await countViews(seeded.dramaId)).toBe(1);
  });

  it('counts a second view once the six-hour window has passed', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const start = new Date('2026-11-24T10:00:00.000Z');

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now: start,
    });
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now: start,
    });

    // Five hours later the window is still open.
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now: new Date(start.getTime() + 5 * 60 * 60 * 1000),
    });
    expect(await countViews(seeded.dramaId)).toBe(1);

    // Seven hours later the window has passed.
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now: new Date(start.getTime() + 7 * 60 * 60 * 1000),
    });
    expect(await countViews(seeded.dramaId)).toBe(2);
  });

  it('counts a view by a different guest session', async () => {
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
    });
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
    });

    expect(await countViews(seeded.dramaId)).toBe(2);
  });

  it('counts a drama and a movie separately', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
    });
    await recordContentView({
      type: 'movie',
      contentId: seeded.movieId,
      userId: null,
      sessionId,
    });

    expect(await countViews(seeded.dramaId)).toBe(1);
    expect(await countViews(seeded.movieId)).toBe(1);
  });

  it('uses one visitor row for a signed-in account across requests', async () => {
    const first = await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: seeded.userId,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
    });
    const second = await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: seeded.userId,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
    });

    expect(first.counted).toBe(true);
    expect(second.alreadyCounted).toBe(true);
    expect(first.visitor.guestSessionId).toBe(second.visitor.guestSessionId);
    expect(await countViews(seeded.dramaId)).toBe(1);
  });

  it('stores no personal identifier on the view event', async () => {
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: seeded.userId,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
    });

    const [row] = await db
      .select({
        guestSessionId: content_view_events.guest_session_id,
        dramaId: content_view_events.drama_id,
        movieId: content_view_events.movie_id,
        bucket: content_view_events.viewed_hour_bucket,
      })
      .from(content_view_events)
      .where(eq(content_view_events.content_id, seeded.dramaId));

    expect(row?.guestSessionId).not.toBeNull();
    expect(row?.dramaId).toBe(seeded.dramaId);
    expect(row?.movieId).toBeNull();
    expect(row?.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
  });

  it('does not count a view of a content item that was deleted while the beacon was in flight', async () => {
    // The title is gone and the beacon arrives late: the insert hits the
    // foreign key. The view is dropped and the request still succeeds, because
    // a view of a deleted title is not an error.
    await db.delete(dramas).where(eq(dramas.id, seeded.dramaId));

    const result = await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: seeded.userId,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
    });

    expect(result.counted).toBe(false);
    expect(result.alreadyCounted).toBe(false);
    expect(await countViews(seeded.dramaId)).toBe(0);
  });
});

describe('analytics visitor', () => {
  let seeded: Seed;

  beforeEach(async () => {
    await cleanupAnalyticsFixtures(TEST_PREFIX);
    seeded = await seed();
  });

  afterEach(async () => {
    await db.delete(guest_sessions).where(eq(guest_sessions.user_id, seeded.userId));
    await db
      .delete(guest_sessions)
      .where(eq(guest_sessions.session_id, `session-${seeded.userId}`));
    await cleanupAnalyticsFixtures(TEST_PREFIX);
  });

  it('reuses the visitor row of a signed-in account', async () => {
    const first = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: `session-${seeded.userId}`,
    });
    const second = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: `session-${seeded.userId}`,
    });

    expect(first.guestSessionId).toBe(second.guestSessionId);
    expect(first.userId).toBe(seeded.userId);
  });

  it('reuses the visitor row of a guest session', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    const first = await resolveAnalyticsVisitor({ userId: null, sessionId });
    const second = await resolveAnalyticsVisitor({ userId: null, sessionId });

    expect(first.guestSessionId).toBe(second.guestSessionId);
    expect(first.userId).toBeNull();
  });

  it('links a guest session to the account that signs in', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    const guest = await resolveAnalyticsVisitor({ userId: null, sessionId });
    const signedIn = await resolveAnalyticsVisitor({ userId: seeded.userId, sessionId });

    expect(signedIn.userId).toBe(seeded.userId);
    expect(signedIn.guestSessionId).toBe(guest.guestSessionId);
  });
});

afterAll(async () => {
  await cleanupAnalyticsFixtures(TEST_PREFIX);
  await closePool();
});
