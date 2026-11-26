import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Playback analytics and aggregation integration coverage (Prompts 141, 142,
 * 143).
 *
 * The player reports discrete events; the aggregation turns them into the
 * daily rows the dashboard reads. The two properties that matter are that the
 * writes stay bounded and that the aggregated numbers are the real ones.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for playback analytics integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import {
  analytics_daily_aggregates,
  content_view_events,
  guest_sessions,
  playback_analytics_events,
} from '@/modules/analytics/schema';
import { aggregateDailyAnalytics, aggregateDateRange } from '@/modules/analytics/aggregation-workflow';
import {
  getPlaybackAnalyticsSummary,
  recordPlaybackEvent,
} from '@/modules/analytics/playback-analytics-workflow';
import { recordContentView } from '@/modules/analytics/view-counting-workflow';
import { closePool } from '@/platform/db/pool';

import { cleanupAnalyticsFixtures } from './support/cleanup';

const TEST_PREFIX = 'it-playback-';
const DAY = '2026-11-26';
const NEXT_DAY = '2026-11-27';

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
    name: 'Playback tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Playback drama',
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
    title: 'Playback movie',
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
    .where(eq(analytics_daily_aggregates.date, DAY));
  await db
    .delete(analytics_daily_aggregates)
    .where(eq(analytics_daily_aggregates.date, NEXT_DAY));
  await db.delete(guest_sessions).where(eq(guest_sessions.user_id, seeded.userId));
}

describe('playback analytics', () => {
  let seeded: Seed;

  beforeEach(async () => {
    await cleanupAnalyticsFixtures(TEST_PREFIX);
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
    await cleanupAnalyticsFixtures(TEST_PREFIX);
  });

  it('records an episode playback event with its episode and drama', async () => {
    const result = await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play_pause',
      positionSeconds: 42,
      watchDurationSeconds: 42,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now: new Date('2026-11-26T10:00:00.000Z'),
    });

    expect(result.recorded).toBe(true);

    const [row] = await db
      .select({
        contentId: playback_analytics_events.content_id,
        contentType: playback_analytics_events.content_type,
        dramaId: playback_analytics_events.drama_id,
        movieId: playback_analytics_events.movie_id,
        episodeId: playback_analytics_events.episode_id,
        bucket: playback_analytics_events.event_hour_bucket,
      })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.content_id, seeded.episodeId));

    expect(row?.contentId).toBe(seeded.episodeId);
    expect(row?.contentType).toBe('drama');
    expect(row?.dramaId).toBe(seeded.dramaId);
    expect(row?.movieId).toBeNull();
    expect(row?.episodeId).toBe(seeded.episodeId);
    expect(row?.bucket).toBe('2026-11-26T10');
  });

  it('records the viewer classification of the request', async () => {
    const now = new Date('2026-11-26T10:00:00.000Z');

    // A signed-in viewer.
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play',
      userId: seeded.userId,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now,
    });

    // An anonymous viewer.
    await recordPlaybackEvent({
      target: { type: 'movie', movieId: seeded.movieId },
      eventType: 'play',
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now,
    });

    const rows = await db
      .select({
        contentId: playback_analytics_events.content_id,
        viewerType: playback_analytics_events.viewer_type,
      })
      .from(playback_analytics_events)
      .where(
        inArray(playback_analytics_events.content_id, [seeded.episodeId, seeded.movieId])
      );

    const episode = rows.find(row => row.contentId === seeded.episodeId);
    const movie = rows.find(row => row.contentId === seeded.movieId);

    expect(episode?.viewerType).toBe('authenticated');
    expect(movie?.viewerType).toBe('guest');
  });

  it('keeps the classification of the request, not of the session row', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T10:00:00.000Z');

    // The viewer watches as a guest, then signs in with the same browser. The
    // session row is linked to the account, but the first event was recorded
    // before the sign-in, so it stays a guest event (D-074).
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now,
    });
    await recordContentView({
      type: 'movie',
      contentId: seeded.movieId,
      userId: seeded.userId,
      sessionId,
      now,
    });

    const rows = await db
      .select({
        contentId: content_view_events.content_id,
        viewerType: content_view_events.viewer_type,
      })
      .from(content_view_events)
      .where(inArray(content_view_events.content_id, [seeded.dramaId, seeded.movieId]));

    const asGuest = rows.find(row => row.contentId === seeded.dramaId);
    const asAccount = rows.find(row => row.contentId === seeded.movieId);

    expect(asGuest?.viewerType).toBe('guest');
    expect(asAccount?.viewerType).toBe('authenticated');
  });

  it('drops a playback event of an episode that was deleted while the beacon was in flight', async () => {
    // The episode is gone and the beacon arrives late: the insert hits the
    // foreign key. The event is dropped and the request still succeeds, because
    // a playback event of a deleted episode is not an error.
    await db.delete(episodes).where(eq(episodes.id, seeded.episodeId));

    const result = await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play_pause',
      watchDurationSeconds: 42,
      userId: null,
      sessionId: `session-${TEST_PREFIX}${randomUUID()}`,
      now: new Date('2026-11-26T10:00:00.000Z'),
    });

    expect(result.recorded).toBe(false);
    expect(result.duplicate).toBe(false);

    const rows = await db
      .select({ id: playback_analytics_events.id })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.content_id, seeded.episodeId));

    expect(rows).toHaveLength(0);
  });

  it('stores at most one event of each type per visitor and hour', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    const first = await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play_pause',
      watchDurationSeconds: 10,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:05:00.000Z'),
    });
    const second = await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play_pause',
      watchDurationSeconds: 20,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:30:00.000Z'),
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(second.duplicate).toBe(true);

    const rows = await db
      .select({ id: playback_analytics_events.id })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.content_id, seeded.episodeId));

    expect(rows).toHaveLength(1);
  });

  it('keeps the event types apart', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T10:00:00.000Z');

    for (const eventType of ['play_pause', 'seek', 'completion', 'exit'] as const) {
      await recordPlaybackEvent({
        target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
        eventType,
        watchDurationSeconds: 30,
        completionThresholdMet: eventType === 'completion',
        userId: null,
        sessionId,
        now,
      });
    }

    const rows = await db
      .select({ eventType: playback_analytics_events.event_type })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.content_id, seeded.episodeId));

    expect(rows.map(row => row.eventType).sort()).toEqual([
      'completion',
      'exit',
      'play_pause',
      'seek',
    ]);
  });

  it('records a completion only on a completion event', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T11:00:00.000Z');

    // A caller that bypasses the validation contract still cannot record a
    // completion on an event type that does not mean one (D-070).
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play_pause',
      watchDurationSeconds: 30,
      completionThresholdMet: true,
      userId: null,
      sessionId,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play',
      watchDurationSeconds: 0,
      userId: null,
      sessionId,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'completion',
      watchDurationSeconds: 120,
      completionThresholdMet: true,
      userId: null,
      sessionId,
      now: new Date(now.getTime() + 120_000),
    });

    const rows = await db
      .select({
        eventType: playback_analytics_events.event_type,
        completionThresholdMet: playback_analytics_events.completion_threshold_met,
      })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.content_id, seeded.episodeId))
      .orderBy(playback_analytics_events.event_at);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      eventType: 'play_pause',
      completionThresholdMet: false,
    });
    expect(rows[2]).toMatchObject({
      eventType: 'completion',
      completionThresholdMet: true,
    });
  });

  it('refuses a completion the watch history does not support', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T12:00:00.000Z');

    // A forged beacon: it claims a completion without a viewing and without a
    // single second of watch time. The server stores the event, because the
    // viewer really did send something, but it is not counted as a completion
    // (D-073).
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'completion',
      watchDurationSeconds: 0,
      completionThresholdMet: true,
      userId: null,
      sessionId,
      now,
    });

    const [forged] = await db
      .select({ completionThresholdMet: playback_analytics_events.completion_threshold_met })
      .from(playback_analytics_events)
      .where(
        and(
          eq(playback_analytics_events.content_id, seeded.episodeId),
          eq(playback_analytics_events.event_type, 'completion')
        )
      );

    expect(forged?.completionThresholdMet).toBe(false);
  });

  it('refuses a completion whose viewing never began', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T12:00:00.000Z');

    // The watch time is real, but there is no playback start behind it: there
    // is no viewing to complete.
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play_pause',
      watchDurationSeconds: 600,
      userId: null,
      sessionId,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'completion',
      watchDurationSeconds: 0,
      completionThresholdMet: true,
      userId: null,
      sessionId,
      now: new Date(now.getTime() + 600_000),
    });

    const [refused] = await db
      .select({ completionThresholdMet: playback_analytics_events.completion_threshold_met })
      .from(playback_analytics_events)
      .where(
        and(
          eq(playback_analytics_events.content_id, seeded.episodeId),
          eq(playback_analytics_events.event_type, 'completion')
        )
      );

    expect(refused?.completionThresholdMet).toBe(false);
  });

  it('counts a completion the watch history supports', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T12:00:00.000Z');

    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play',
      watchDurationSeconds: 0,
      userId: null,
      sessionId,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'completion',
      watchDurationSeconds: 600,
      completionThresholdMet: true,
      userId: null,
      sessionId,
      now: new Date(now.getTime() + 600_000),
    });

    const [counted] = await db
      .select({ completionThresholdMet: playback_analytics_events.completion_threshold_met })
      .from(playback_analytics_events)
      .where(
        and(
          eq(playback_analytics_events.content_id, seeded.episodeId),
          eq(playback_analytics_events.event_type, 'completion')
        )
      );

    expect(counted?.completionThresholdMet).toBe(true);
  });

  it('summarises the events and the watch time of a title', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T10:00:00.000Z');

    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play',
      watchDurationSeconds: 0,
      userId: null,
      sessionId,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play_pause',
      watchDurationSeconds: 120,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:02:00.000Z'),
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'completion',
      watchDurationSeconds: 180,
      completionThresholdMet: true,
      userId: null,
      sessionId,
      // Three minutes after the pause: the watch time of the completion is the
      // time that passed since the previous stored event.
      now: new Date('2026-11-26T10:05:00.000Z'),
    });

    const summary = await getPlaybackAnalyticsSummary('drama', seeded.dramaId);

    expect(summary.totalPlaybackEvents).toBe(3);
    expect(summary.completionEvents).toBe(1);
    expect(summary.totalWatchDurationSeconds).toBe(300);
  });

  it('clamps a watch duration that exceeds the time since the previous event', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play',
      watchDurationSeconds: 0,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:00:00.000Z'),
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play_pause',
      // A beacon that claims a day of watching one minute after the first
      // event is a fabricated claim.
      watchDurationSeconds: 86_400,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:01:00.000Z'),
    });

    const [row] = await db
      .select({ watchDurationSeconds: playback_analytics_events.watch_duration_seconds })
      .from(playback_analytics_events)
      .where(
        and(
          eq(playback_analytics_events.content_id, seeded.episodeId),
          eq(playback_analytics_events.event_type, 'play_pause')
        )
      );

    // 60 seconds elapsed, plus the tolerance.
    expect(row?.watchDurationSeconds).toBe(90);
  });

  it('drops a media position that no title can reach', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play',
      positionSeconds: 999_999_999,
      watchDurationSeconds: 10,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:00:00.000Z'),
    });

    const [row] = await db
      .select({ positionSeconds: playback_analytics_events.position_seconds })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.content_id, seeded.episodeId));

    expect(row?.positionSeconds).toBeNull();
  });
});

describe('analytics aggregation', () => {
  let seeded: Seed;

  beforeEach(async () => {
    await cleanupAnalyticsFixtures(TEST_PREFIX);
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
    await cleanupAnalyticsFixtures(TEST_PREFIX);
  });

  it('writes the site, drama and movie rows of a Dhaka day', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T10:00:00.000Z');

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now,
    });
    await recordContentView({
      type: 'movie',
      contentId: seeded.movieId,
      userId: null,
      sessionId,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'play',
      watchDurationSeconds: 0,
      userId: null,
      sessionId,
      now,
    });
    await recordPlaybackEvent({
      target: { type: 'drama', episodeId: seeded.episodeId, dramaId: seeded.dramaId },
      eventType: 'completion',
      watchDurationSeconds: 90,
      completionThresholdMet: true,
      userId: null,
      sessionId,
      now: new Date(now.getTime() + 90_000),
    });

    await aggregateDailyAnalytics(DAY, null, null);
    await aggregateDailyAnalytics(DAY, 'drama', null);
    await aggregateDailyAnalytics(DAY, 'movie', null);

    const rows = await db
      .select({
        contentType: analytics_daily_aggregates.content_type,
        contentId: analytics_daily_aggregates.content_id,
        uniqueVisitors: analytics_daily_aggregates.unique_visitors,
        totalViews: analytics_daily_aggregates.total_views,
        totalPlaybackEvents: analytics_daily_aggregates.total_playback_events,
        completionEvents: analytics_daily_aggregates.completion_events,
        totalWatchDurationSeconds: analytics_daily_aggregates.total_watch_duration_seconds,
      })
      .from(analytics_daily_aggregates)
      .where(
        and(
          eq(analytics_daily_aggregates.date, DAY),
          isNull(analytics_daily_aggregates.deleted_at)
        )
      );

    const site = rows.find(row => row.contentType === null);
    const drama = rows.find(row => row.contentType === 'drama');
    const movie = rows.find(row => row.contentType === 'movie');

    expect(site?.totalViews).toBe(2);
    expect(site?.uniqueVisitors).toBe(1);
    expect(site?.totalPlaybackEvents).toBe(2);
    expect(site?.completionEvents).toBe(1);
    expect(site?.totalWatchDurationSeconds).toBe(90);

    expect(drama?.contentId).toBe(seeded.dramaId);
    expect(drama?.totalViews).toBe(1);
    expect(drama?.totalPlaybackEvents).toBe(2);

    expect(movie?.contentId).toBe(seeded.movieId);
    expect(movie?.totalViews).toBe(1);
    expect(movie?.totalPlaybackEvents).toBe(0);
  });

  it('counts a visitor once for the whole site', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T10:00:00.000Z');

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now,
    });
    await recordContentView({
      type: 'movie',
      contentId: seeded.movieId,
      userId: null,
      sessionId,
      now,
    });

    await aggregateDailyAnalytics(DAY, null, null);

    const [site] = await db
      .select({ uniqueVisitors: analytics_daily_aggregates.unique_visitors })
      .from(analytics_daily_aggregates)
      .where(
        and(
          eq(analytics_daily_aggregates.date, DAY),
          isNull(analytics_daily_aggregates.content_type)
        )
      );

    expect(site?.uniqueVisitors).toBe(1);
  });

  it('replaces the rows of the day instead of adding to them', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;
    const now = new Date('2026-11-26T10:00:00.000Z');

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now,
    });

    await aggregateDailyAnalytics(DAY, null, null);
    await aggregateDailyAnalytics(DAY, null, null);

    const rows = await db
      .select({ totalViews: analytics_daily_aggregates.total_views })
      .from(analytics_daily_aggregates)
      .where(
        and(
          eq(analytics_daily_aggregates.date, DAY),
          isNull(analytics_daily_aggregates.content_type)
        )
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalViews).toBe(1);
  });

  it('aggregates a range of days in one pass and stays idempotent', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:00:00.000Z'),
    });
    await recordContentView({
      type: 'movie',
      contentId: seeded.movieId,
      userId: null,
      sessionId,
      now: new Date('2026-11-27T10:00:00.000Z'),
    });

    await aggregateDateRange(DAY, NEXT_DAY);
    await aggregateDateRange(DAY, NEXT_DAY);

    const rows = await db
      .select({
        date: analytics_daily_aggregates.date,
        contentType: analytics_daily_aggregates.content_type,
        totalViews: analytics_daily_aggregates.total_views,
      })
      .from(analytics_daily_aggregates)
      .where(
        and(
          inArray(analytics_daily_aggregates.date, [DAY, NEXT_DAY]),
          isNull(analytics_daily_aggregates.content_type),
          isNull(analytics_daily_aggregates.deleted_at)
        )
      )
      .orderBy(analytics_daily_aggregates.date);

    // One site row per day of the range, and the second run did not double
    // the numbers.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.date).toBe(DAY);
    expect(rows[0]?.totalViews).toBe(1);
    expect(rows[1]?.date).toBe(NEXT_DAY);
    expect(rows[1]?.totalViews).toBe(1);
  });

  it('puts an event into the Dhaka day it belongs to', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    // 20:30 UTC is already the next day in Dhaka.
    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T20:30:00.000Z'),
    });

    await aggregateDailyAnalytics(NEXT_DAY, null, null);

    const rows = await db
      .select({ date: analytics_daily_aggregates.date })
      .from(analytics_daily_aggregates)
      .where(
        and(
          eq(analytics_daily_aggregates.date, NEXT_DAY),
          isNull(analytics_daily_aggregates.content_type),
          isNull(analytics_daily_aggregates.deleted_at)
        )
      );

    expect(rows.map(row => row.date)).toEqual([NEXT_DAY]);
  });

  it('writes one row per day when two refreshes run at the same time', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:00:00.000Z'),
    });

    // The dashboard refreshes the current day every minute and an
    // administrator may press the refresh button as well, so two refreshes of
    // the same scope may overlap. The result must still be one row per day.
    await Promise.all([
      aggregateDailyAnalytics(DAY, null, null),
      aggregateDailyAnalytics(DAY, null, null),
    ]);

    const rows = await db
      .select({ id: analytics_daily_aggregates.id })
      .from(analytics_daily_aggregates)
      .where(
        and(
          eq(analytics_daily_aggregates.date, DAY),
          isNull(analytics_daily_aggregates.content_type),
          isNull(analytics_daily_aggregates.deleted_at)
        )
      );

    expect(rows).toHaveLength(1);
  });

  it('refuses a second row for the same day and target', async () => {
    const sessionId = `session-${TEST_PREFIX}${randomUUID()}`;

    await recordContentView({
      type: 'drama',
      contentId: seeded.dramaId,
      userId: null,
      sessionId,
      now: new Date('2026-11-26T10:00:00.000Z'),
    });

    await aggregateDailyAnalytics(DAY, null, null);

    // The database is the authority that makes a duplicate row impossible.
    await expect(
      db.insert(analytics_daily_aggregates).values({
        date: DAY,
        content_type: null,
        content_id: null,
        unique_visitors: 1,
        total_views: 1,
      })
    ).rejects.toThrow();

    const rows = await db
      .select({ id: analytics_daily_aggregates.id })
      .from(analytics_daily_aggregates)
      .where(
        and(
          eq(analytics_daily_aggregates.date, DAY),
          isNull(analytics_daily_aggregates.content_type),
          isNull(analytics_daily_aggregates.deleted_at)
        )
      );

    expect(rows).toHaveLength(1);
  });
});

afterAll(async () => {
  await cleanupAnalyticsFixtures(TEST_PREFIX);
  await closePool();
});
