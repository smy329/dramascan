import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Analytics retention integration coverage (Prompt 139).
 *
 * The retention policy has three rules, and each of them is checked here
 * against the real PostgreSQL test database:
 *
 *   1. the raw events are removed once they are older than the window;
 *   2. a guest-session row is removed only when no event points at it any
 *      more, because the visitor key is what the unique-visitor counts are
 *      made of;
 *   3. a session row linked to an account is never removed, because it is
 *      that account's stable visitor key.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for the analytics retention integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import {
  analytics_daily_aggregates,
  content_view_events,
  guest_sessions,
  playback_analytics_events,
  playback_viewing_sessions,
  search_events,
} from '@/modules/analytics/schema';
import { purgeExpiredGuestData } from '@/modules/analytics/retention';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-retention-';
const NOW = new Date('2026-11-25T12:00:00.000Z');
const OLD_DAY = '2024-01-01';
const RECENT_DAY = '2026-11-20';
const OLD_INSTANT = '2020-01-02T00:00:00.000Z';
const RECENT_INSTANT = '2026-11-20T00:00:00.000Z';

type Seed = {
  userId: string;
  dramaId: string;
  episodeId: string;
  movieId: string;
  /** Old, and every event of it is expired: it may go. */
  expiredSessionId: string;
  /** Old, and linked to the account: it may never go. */
  linkedSessionId: string;
  /** Old, but a recent event still points at it: it may not go. */
  referencedSessionId: string;
  /** Recent: it is not expired at all. */
  recentSessionId: string;
  /** Old, and only a stale viewing session points at it: it may go. */
  viewingSessionId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const movieId = randomUUID();
  const expiredSessionId = randomUUID();
  const linkedSessionId = randomUUID();
  const referencedSessionId = randomUUID();
  const recentSessionId = randomUUID();
  const viewingSessionId = randomUUID();

  await db.insert(users).values({
    id: userId,
    name: 'Retention tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Retention drama',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
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
    title: 'Retention movie',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/1.mp4',
  });

  await db.insert(guest_sessions).values([
    {
      id: expiredSessionId,
      session_id: `session-${TEST_PREFIX}${randomUUID()}`,
      created_at: new Date(OLD_INSTANT),
      updated_at: new Date(OLD_INSTANT),
    },
    {
      id: linkedSessionId,
      session_id: `session-${TEST_PREFIX}${randomUUID()}`,
      user_id: userId,
      created_at: new Date(OLD_INSTANT),
      updated_at: new Date(OLD_INSTANT),
    },
    {
      id: referencedSessionId,
      session_id: `session-${TEST_PREFIX}${randomUUID()}`,
      created_at: new Date(OLD_INSTANT),
      updated_at: new Date(OLD_INSTANT),
    },
    {
      id: recentSessionId,
      session_id: `session-${TEST_PREFIX}${randomUUID()}`,
      created_at: new Date(RECENT_INSTANT),
      updated_at: new Date(RECENT_INSTANT),
    },
    {
      id: viewingSessionId,
      session_id: `session-${TEST_PREFIX}${randomUUID()}`,
      created_at: new Date(OLD_INSTANT),
      updated_at: new Date(OLD_INSTANT),
    },
  ]);

  // A stale viewing session: the server's baseline of a viewing that ended
  // long ago. It is expired, so it may go.
  await db.insert(playback_viewing_sessions).values({
    guest_session_id: viewingSessionId,
    content_id: dramaId,
    content_type: 'drama',
    drama_id: dramaId,
    movie_id: null,
    client_session_key: `key-${randomUUID()}`,
    started_at: new Date(OLD_INSTANT),
    last_event_at: new Date(OLD_INSTANT),
    last_cumulative_watch_seconds: 120,
  });

  // A recent viewing session: it is not expired, so it stays.
  await db.insert(playback_viewing_sessions).values({
    guest_session_id: referencedSessionId,
    content_id: dramaId,
    content_type: 'drama',
    drama_id: dramaId,
    movie_id: null,
    client_session_key: `key-${randomUUID()}`,
    started_at: new Date(RECENT_INSTANT),
    last_event_at: new Date(RECENT_INSTANT),
    last_cumulative_watch_seconds: 30,
  });

  // Two expired view events of the same visitor: the batch size has to be
  // observable, so there is more than one expired row.
  await db.insert(content_view_events).values([
    {
      guest_session_id: expiredSessionId,
      content_id: dramaId,
      content_type: 'drama',
      drama_id: dramaId,
      viewed_at: new Date(OLD_INSTANT),
      viewed_hour_bucket: '2020-01-02T00',
    },
    {
      guest_session_id: expiredSessionId,
      content_id: dramaId,
      content_type: 'drama',
      drama_id: dramaId,
      viewed_at: new Date('2020-01-02T01:00:00.000Z'),
      viewed_hour_bucket: '2020-01-02T01',
    },
  ]);

  // A recent view of an old session: the session is old, but this event is
  // inside the window, so the session may not be removed.
  await db.insert(content_view_events).values({
    guest_session_id: referencedSessionId,
    content_id: dramaId,
    content_type: 'drama',
    drama_id: dramaId,
    viewed_at: new Date(RECENT_INSTANT),
    viewed_hour_bucket: '2026-11-20T00',
  });

  await db.insert(playback_analytics_events).values({
    guest_session_id: expiredSessionId,
    content_id: dramaId,
    content_type: 'drama',
    drama_id: dramaId,
    episode_id: episodeId,
    event_type: 'play_pause',
    position_seconds: 0,
    watch_duration_seconds: 30,
    event_at: new Date('2020-01-03T00:00:00.000Z'),
    event_hour_bucket: '2020-01-03T00',
  });

  await db.insert(search_events).values({
    guest_session_id: expiredSessionId,
    query_text: 'retention search',
    result_count: 1,
    searched_at: new Date('2020-01-04T00:00:00.000Z'),
    search_hour_bucket: '2020-01-04T00',
  });

  await db.insert(analytics_daily_aggregates).values([
    {
      date: OLD_DAY,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      unique_visitors: 1,
      total_views: 1,
    },
    {
      date: RECENT_DAY,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      unique_visitors: 1,
      total_views: 1,
    },
  ]);

  return {
    userId,
    dramaId,
    episodeId,
    movieId,
    expiredSessionId,
    linkedSessionId,
    referencedSessionId,
    recentSessionId,
    viewingSessionId,
  };
}

async function cleanup(seeded: Seed): Promise<void> {
  await db
    .delete(playback_viewing_sessions)
    .where(
      inArray(playback_viewing_sessions.guest_session_id, [
        seeded.expiredSessionId,
        seeded.linkedSessionId,
        seeded.referencedSessionId,
        seeded.recentSessionId,
        seeded.viewingSessionId,
      ])
    );
  await db
    .delete(playback_analytics_events)
    .where(eq(playback_analytics_events.drama_id, seeded.dramaId));
  await db.delete(content_view_events).where(eq(content_view_events.content_id, seeded.dramaId));
  await db
    .delete(analytics_daily_aggregates)
    .where(eq(analytics_daily_aggregates.drama_id, seeded.dramaId));
  await db.delete(search_events).where(eq(search_events.guest_session_id, seeded.expiredSessionId));
  await db
    .delete(guest_sessions)
    .where(
      inArray(guest_sessions.id, [
        seeded.expiredSessionId,
        seeded.linkedSessionId,
        seeded.referencedSessionId,
        seeded.recentSessionId,
        seeded.viewingSessionId,
      ])
    );
  await db.delete(episodes).where(eq(episodes.drama_id, seeded.dramaId));
  await db.delete(seasons).where(eq(seasons.drama_id, seeded.dramaId));
  await db.delete(dramas).where(eq(dramas.id, seeded.dramaId));
  await db.delete(movies).where(eq(movies.id, seeded.movieId));
  await db.delete(users).where(eq(users.id, seeded.userId));
}

describe('analytics retention', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  afterAll(async () => {
    await closePool();
  });

  it('removes the events that are older than the retention window and keeps the recent ones', async () => {
    const result = await purgeExpiredGuestData({ now: NOW, retentionDays: 400 });

    expect(result.contentViewEvents).toBe(2);
    expect(result.playbackAnalyticsEvents).toBe(1);
    expect(result.searchEvents).toBe(1);

    const views = await db
      .select({ viewedAt: content_view_events.viewed_at })
      .from(content_view_events)
      .where(eq(content_view_events.content_id, seeded.dramaId));

    expect(views).toHaveLength(1);
    expect(views[0]?.viewedAt.toISOString()).toBe(RECENT_INSTANT);

    const playbacks = await db
      .select({ eventAt: playback_analytics_events.event_at })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.drama_id, seeded.dramaId));

    expect(playbacks).toHaveLength(0);
  });

  it('removes the daily aggregates of the days that are outside the window', async () => {
    const result = await purgeExpiredGuestData({ now: NOW, retentionDays: 400 });

    expect(result.analyticsDailyAggregates).toBe(1);

    const rows = await db
      .select({ date: analytics_daily_aggregates.date })
      .from(analytics_daily_aggregates)
      .where(eq(analytics_daily_aggregates.drama_id, seeded.dramaId));

    expect(rows.map(row => row.date)).toEqual([RECENT_DAY]);
  });

  it('removes an expired guest session once no event points at it any more', async () => {
    await purgeExpiredGuestData({ now: NOW, retentionDays: 400 });

    const remaining = await db
      .select({ id: guest_sessions.id })
      .from(guest_sessions)
      .where(
        inArray(guest_sessions.id, [
          seeded.expiredSessionId,
          seeded.linkedSessionId,
          seeded.referencedSessionId,
          seeded.recentSessionId,
        ])
      );

    const remainingIds = remaining.map(row => row.id);

    // The anonymous session was old and had no event left: it is gone.
    expect(remainingIds).not.toContain(seeded.expiredSessionId);
    // The session that still has a recent event stays.
    expect(remainingIds).toContain(seeded.referencedSessionId);
    // The recent session is not expired at all.
    expect(remainingIds).toContain(seeded.recentSessionId);
    // The account's own visitor key is never removed.
    expect(remainingIds).toContain(seeded.linkedSessionId);
  });

  it('removes the expired viewing sessions and keeps the recent ones', async () => {
    // The viewing session is the server's baseline of a viewing. Once it is
    // stale it is of no use to any later beacon, and it may go (D-090).
    const result = await purgeExpiredGuestData({ now: NOW, retentionDays: 400 });

    expect(result.playbackViewingSessions).toBe(1);

    const remaining = await db
      .select({ guestSessionId: playback_viewing_sessions.guest_session_id })
      .from(playback_viewing_sessions)
      .where(
        inArray(playback_viewing_sessions.guest_session_id, [
          seeded.viewingSessionId,
          seeded.referencedSessionId,
        ])
      );

    // The stale baseline is gone, the recent one stays.
    expect(remaining.map(row => row.guestSessionId)).toEqual([seeded.referencedSessionId]);
  });

  it('keeps a guest session while a viewing session still points at it', async () => {
    // The baseline and the visitor key belong together: removing the visitor
    // key would take the baseline of a live viewing with it.
    await purgeExpiredGuestData({ now: NOW, retentionDays: 400 });

    const remaining = await db
      .select({ id: guest_sessions.id })
      .from(guest_sessions)
      .where(eq(guest_sessions.id, seeded.referencedSessionId));

    expect(remaining).toHaveLength(1);
  });

  it('removes at most one batch of rows per table', async () => {
    const result = await purgeExpiredGuestData({ now: NOW, retentionDays: 400, batchSize: 1 });

    // Two view events are expired, but the batch size allows only one row
    // from one table.
    expect(result.contentViewEvents).toBe(1);

    const views = await db
      .select({ bucket: content_view_events.viewed_hour_bucket })
      .from(content_view_events)
      .where(eq(content_view_events.content_id, seeded.dramaId));

    expect(views).toHaveLength(2);
  });
});
