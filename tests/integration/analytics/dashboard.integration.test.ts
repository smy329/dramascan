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
    const playbackSession = `session-${TEST_PREFIX}${randomUUID()}`;

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play',
      watchDurationSeconds: 0,
      userId: null,
      sessionId: playbackSession,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'completion',
      watchDurationSeconds: 300,
      completionThresholdMet: true,
      userId: null,
      sessionId: playbackSession,
      // The watch time of an event is the time that passed since the previous
      // one, so the completion comes five minutes after the start.
      now: new Date('2026-11-24T10:05:00.000Z'),
    });

    await aggregateDailyAnalytics(DAY, null, null);
    await aggregateDailyAnalytics(DAY, 'drama', null);
    await aggregateDailyAnalytics(DAY, 'movie', null);

    const range = buildDateRange(DAY, DAY);
    const overview = await getAnalyticsOverview(range);

    expect(overview.totalViews).toBe(1);
    expect(overview.totalPlaybackEvents).toBe(2);
    expect(overview.playbackStarts).toBe(1);
    expect(overview.playbackViewers).toBe(1);
    expect(overview.completionEvents).toBe(1);
    expect(overview.completionRate).toBe(1);
    expect(overview.totalWatchDurationSeconds).toBe(300);
    // The view and the playback came from two different guest sessions, so the
    // site-wide visitor count is two while only one of them played.
    expect(overview.uniqueVisitors).toBe(2);
    expect(overview.averageWatchDurationSeconds).toBe(300);
  });

  it('measures the completion rate against playback starts, not every event', async () => {
    const now = new Date('2026-11-24T10:00:00.000Z');
    const completingSession = `session-${TEST_PREFIX}${randomUUID()}`;
    const leavingSession = `session-${TEST_PREFIX}${randomUUID()}`;
    const target = {
      type: 'drama' as const,
      episodeId: seeded.episodeId,
      dramaId: seeded.dramaId,
    };

    // One viewer starts, pauses, seeks, and finishes.
    await recordPlaybackEvent({
      target,
      eventType: 'play',
      watchDurationSeconds: 0,
      userId: null,
      sessionId: completingSession,
      now,
    });
    await recordPlaybackEvent({
      target,
      eventType: 'play_pause',
      watchDurationSeconds: 30,
      userId: null,
      sessionId: completingSession,
      now: new Date('2026-11-24T10:01:00.000Z'),
    });
    await recordPlaybackEvent({
      target,
      eventType: 'seek',
      watchDurationSeconds: 10,
      userId: null,
      sessionId: completingSession,
      now: new Date('2026-11-24T10:02:00.000Z'),
    });
    await recordPlaybackEvent({
      target,
      eventType: 'completion',
      watchDurationSeconds: 260,
      completionThresholdMet: true,
      userId: null,
      sessionId: completingSession,
      now: new Date('2026-11-24T10:06:00.000Z'),
    });
    // A second viewer starts and leaves without finishing.
    await recordPlaybackEvent({
      target,
      eventType: 'play',
      watchDurationSeconds: 0,
      userId: null,
      sessionId: leavingSession,
      now,
    });

    await aggregateDailyAnalytics(DAY, null, null);
    await aggregateDailyAnalytics(DAY, 'drama', null);

    const range = buildDateRange(DAY, DAY);
    const overview = await getAnalyticsOverview(range);
    const activity = await listViewerActivity(range);
    const dramaRow = (await listContentPerformance(range)).find(row => row.id === seeded.dramaId);

    // Five stored events, but only two playback starts and one completion.
    expect(overview.totalPlaybackEvents).toBe(5);
    expect(overview.playbackStarts).toBe(2);
    expect(overview.playbackViewers).toBe(2);
    expect(overview.completionEvents).toBe(1);
    expect(overview.completionRate).toBe(0.5);
    // The pauses and the seek must not be mistaken for starts.
    expect(dramaRow?.playbackStarts).toBe(2);
    expect(dramaRow?.completionRate).toBe(0.5);
    // Watch time is averaged over the viewers who played, not every visitor.
    expect(overview.totalWatchDurationSeconds).toBe(300);
    expect(overview.averageWatchDurationSeconds).toBe(150);
    expect(activity[0]?.playbackViewers).toBe(2);
    expect(activity[0]?.averageWatchDurationSeconds).toBe(150);
  });

  it('counts a viewer who played on several days as one viewer of the range', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const target = {
      type: 'drama' as const,
      episodeId: seeded.episodeId,
      dramaId: seeded.dramaId,
    };

    // The same viewer plays on two days of the range.
    for (const day of ['2026-11-23', '2026-11-24']) {
      await recordPlaybackEvent({
        target,
        eventType: 'play',
        watchDurationSeconds: 0,
        userId: null,
        sessionId,
        now: new Date(`${day}T10:00:00.000Z`),
      });
      await recordPlaybackEvent({
        target,
        eventType: 'play_pause',
        watchDurationSeconds: 300,
        userId: null,
        sessionId,
        now: new Date(`${day}T10:05:00.000Z`),
      });
    }

    await aggregateDailyAnalytics('2026-11-23', null, null);
    await aggregateDailyAnalytics('2026-11-24', null, null);

    const range = buildDateRange('2026-11-23', '2026-11-24');
    const overview = await getAnalyticsOverview(range);
    const activity = await listViewerActivity(range);

    // One viewer, not one viewer per day: the daily table keeps its own
    // per-day count, but the range counts the distinct viewers.
    expect(overview.playbackViewers).toBe(1);
    expect(overview.totalWatchDurationSeconds).toBe(600);
    expect(overview.averageWatchDurationSeconds).toBe(600);
    expect(activity.map(row => row.playbackViewers)).toEqual([1, 1]);
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

    // A day with no events produces no aggregate row at all, so the assertion
    // needs one real event to write.
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now: new Date('2026-11-24T10:00:00.000Z'),
    });

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
