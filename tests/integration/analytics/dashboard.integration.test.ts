import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Analytics dashboard integration coverage (Prompts 144, 145, 146).
 *
 * The dashboard reads the stored daily aggregates and answers the four
 * questions an administrator asks. The date range is bounded, and the
 * displayed day is the `Asia/Dhaka` day.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for dashboard integration tests.');
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
} from '@/modules/analytics/schema';
import { aggregateDailyAnalytics } from '@/modules/analytics/aggregation-workflow';
import { buildDateRange, resolveDateRange } from '@/modules/analytics/date-filters';
import {
  getAnalyticsLastUpdated,
  getAnalyticsOverview,
  listContentPerformance,
  listEngagementTrend,
  listViewerActivity,
} from '@/modules/analytics/read-models/dashboard';
import { recordContentView } from '@/modules/analytics/view-counting-workflow';
import { recordPlaybackEvent } from '@/modules/analytics/playback-analytics-workflow';
import { closePool } from '@/platform/db/pool';

import { cleanupAnalyticsFixtures } from './support/cleanup';

const TEST_PREFIX = 'it-dashboard-';
const DAY = '2026-11-24';

type Seed = {
  userId: string;
  dramaId: string;
  episodeId: string;
  movieId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const movieId = randomUUID();

  await db.insert(users).values({
    id: userId,
    name: 'Dashboard tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Dashboard drama',
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
    title: 'Dashboard movie',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/1.mp4',
  });

  return { userId, dramaId, episodeId, movieId };
}

async function cleanup(seeded: Seed): Promise<void> {
  await db
    .delete(playback_analytics_events)
    .where(eq(playback_analytics_events.drama_id, seeded.dramaId));
  await db
    .delete(playback_analytics_events)
    .where(eq(playback_analytics_events.movie_id, seeded.movieId));
  await db.delete(content_view_events).where(eq(content_view_events.content_id, seeded.dramaId));
  await db.delete(content_view_events).where(eq(content_view_events.content_id, seeded.movieId));
  await db
    .delete(analytics_daily_aggregates)
    .where(inArray(analytics_daily_aggregates.date, ['2026-11-22', '2026-11-23', '2026-11-24']));
  await db.delete(guest_sessions).where(eq(guest_sessions.user_id, seeded.userId));
}

describe('analytics dashboard', () => {
  let seeded: Seed;

  beforeEach(async () => {
    await cleanupAnalyticsFixtures(TEST_PREFIX);
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
    await cleanupAnalyticsFixtures(TEST_PREFIX);
  });

  it('summarises the selected range', async () => {
    const now = new Date('2026-11-24T10:00:00.000Z');

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'completion',
      watchDurationSeconds: 300,
      completionThresholdMet: true,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now,
    });

    await aggregateDailyAnalytics(DAY, null, null);
    await aggregateDailyAnalytics(DAY, 'drama', null);
    await aggregateDailyAnalytics(DAY, 'movie', null);

    const range = buildDateRange(DAY, DAY);
    const overview = await getAnalyticsOverview(range);

    expect(overview.totalViews).toBe(1);
    expect(overview.totalPlaybackEvents).toBe(1);
    expect(overview.completionEvents).toBe(1);
    expect(overview.completionRate).toBe(1);
    expect(overview.totalWatchDurationSeconds).toBe(300);
    expect(overview.uniqueVisitors).toBe(2);
  });

  it('lists the content performance rows with their titles', async () => {
    const now = new Date('2026-11-24T10:00:00.000Z');

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now,
    });
    await recordContentView({
      type: 'movie',
      contentId: seeded.movieId,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now,
    });

    await aggregateDailyAnalytics(DAY, 'drama', null);
    await aggregateDailyAnalytics(DAY, 'movie', null);

    const range = buildDateRange(DAY, DAY);
    const rows = await listContentPerformance(range);
    const dramaRow = rows.find(row => row.id === seeded.dramaId);
    const movieRow = rows.find(row => row.id === seeded.movieId);

    expect(dramaRow?.title).toBe('Dashboard drama');
    expect(dramaRow?.views).toBe(1);
    expect(dramaRow?.uniqueVisitors).toBe(1);
    expect(movieRow?.title).toBe('Dashboard movie');
    expect(movieRow?.views).toBe(1);
  });

  it('fills the days of the trend so a quiet day is a zero and not a gap', async () => {
    const range = buildDateRange('2026-11-22', '2026-11-24');

    const trend = await listEngagementTrend(range);
    const activity = await listViewerActivity(range);

    expect(trend).toHaveLength(3);
    expect(trend.map(point => point.date)).toEqual([
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
    ]);
    expect(trend.every(point => point.totalViews === 0)).toBe(true);
    expect(activity).toHaveLength(3);
  });

  it('reads the range from a preset', () => {
    const range = resolveDateRange('last_7_days', new Date('2026-11-24T12:00:00.000Z'));

    expect(range.startDate).toBe('2026-11-18');
    expect(range.endDate).toBe('2026-11-24');
    expect(range.dayCount).toBe(7);
  });

  it('reports when the aggregates were last written', async () => {
    const before = await getAnalyticsLastUpdated();

    await aggregateDailyAnalytics(DAY, null, null);

    const after = await getAnalyticsLastUpdated();

    expect(after).not.toBeNull();
    expect(before === null || (after?.getTime() ?? 0) >= before.getTime()).toBe(true);
  });
});

afterAll(async () => {
  await cleanupAnalyticsFixtures(TEST_PREFIX);
  await closePool();
});
