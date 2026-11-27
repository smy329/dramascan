import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Analytics visitor reconciliation integration coverage (Phase 11 review S1).
 *
 * A browser may create an anonymous visitor row before the viewer signs in.
 * If the account already has its canonical visitor row, the anonymous row must
 * be reconciled into it in one transaction instead of remaining orphaned.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required for the analytics visitor reconciliation integration tests.'
    );
  }

  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');

  if (!databaseName.endsWith('_test')) {
    throw new Error('The test database name must end with "_test".');
  }

  if (process.env.DATABASE_URL === testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, inArray, isNull, like, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import {
  content_view_events,
  guest_sessions,
  playback_analytics_events,
  playback_viewing_sessions,
  search_events,
} from '@/modules/analytics/schema';
import { resolveAnalyticsVisitor } from '@/modules/analytics/visitor';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'r5s1-';
const SESSION_PREFIX = `session-${TEST_PREFIX}`;
const HOUR_BUCKET = '2026-11-27T10';
const EVENT_AT = new Date('2026-11-27T10:30:00.000Z');

type Seed = {
  userId: string;
  dramaId: string;
  seasonId: string;
  episodeId: string;
  guestRowId: string;
  guestSessionId: string;
};

type CanonicalVisitor = {
  rowId: string;
  sessionId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const guestRowId = randomUUID();
  const guestSessionId = `${SESSION_PREFIX}${randomUUID()}`;

  await db.insert(users).values({
    id: userId,
    name: 'Visitor reconciliation tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Visitor reconciliation drama',
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
    video_source: 'https://media.example.com/episodes/reconciliation.mp4',
  });

  await db.insert(guest_sessions).values({
    id: guestRowId,
    session_id: guestSessionId,
  });

  return {
    userId,
    dramaId,
    seasonId,
    episodeId,
    guestRowId,
    guestSessionId,
  };
}

async function insertCanonicalVisitor(userId: string): Promise<CanonicalVisitor> {
  const rowId = randomUUID();
  const sessionId = `${SESSION_PREFIX}${randomUUID()}`;

  await db.insert(guest_sessions).values({
    id: rowId,
    session_id: sessionId,
    user_id: userId,
  });

  return { rowId, sessionId };
}

async function cleanup(seeded: Seed): Promise<void> {
  const linkedVisitorRows = await db
    .select({ id: guest_sessions.id })
    .from(guest_sessions)
    .where(eq(guest_sessions.user_id, seeded.userId));
  const visitorIds = [seeded.guestRowId, ...linkedVisitorRows.map(row => row.id)];

  await db
    .delete(playback_viewing_sessions)
    .where(
      or(
        inArray(playback_viewing_sessions.guest_session_id, visitorIds),
        eq(playback_viewing_sessions.content_id, seeded.dramaId)
      )
    );
  await db
    .delete(playback_analytics_events)
    .where(
      or(
        inArray(playback_analytics_events.guest_session_id, visitorIds),
        eq(playback_analytics_events.drama_id, seeded.dramaId),
        eq(playback_analytics_events.episode_id, seeded.episodeId)
      )
    );
  await db
    .delete(content_view_events)
    .where(
      or(
        inArray(content_view_events.guest_session_id, visitorIds),
        eq(content_view_events.drama_id, seeded.dramaId),
        eq(content_view_events.content_id, seeded.dramaId)
      )
    );
  await db.delete(search_events).where(inArray(search_events.guest_session_id, visitorIds));
  await db.delete(guest_sessions).where(inArray(guest_sessions.id, visitorIds));
  await db.delete(episodes).where(eq(episodes.id, seeded.episodeId));
  await db.delete(seasons).where(eq(seasons.id, seeded.seasonId));
  await db.delete(dramas).where(eq(dramas.id, seeded.dramaId));
  await db.delete(users).where(eq(users.id, seeded.userId));
}

async function cleanupR5s1Fixtures(): Promise<void> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_PREFIX}%`));
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_PREFIX}%`));
  const visitorRows = await db
    .select({ id: guest_sessions.id })
    .from(guest_sessions)
    .where(like(guest_sessions.session_id, `${SESSION_PREFIX}%`));

  const userIds = userRows.map(row => row.id);
  const dramaIds = dramaRows.map(row => row.id);
  const visitorIds = visitorRows.map(row => row.id);

  if (userIds.length > 0) {
    const linkedVisitorRows = await db
      .select({ id: guest_sessions.id })
      .from(guest_sessions)
      .where(inArray(guest_sessions.user_id, userIds));

    visitorIds.push(...linkedVisitorRows.map(row => row.id));
  }

  if (visitorIds.length > 0) {
    await db
      .delete(playback_viewing_sessions)
      .where(inArray(playback_viewing_sessions.guest_session_id, visitorIds));
    await db
      .delete(playback_analytics_events)
      .where(inArray(playback_analytics_events.guest_session_id, visitorIds));
    await db
      .delete(content_view_events)
      .where(inArray(content_view_events.guest_session_id, visitorIds));
    await db.delete(search_events).where(inArray(search_events.guest_session_id, visitorIds));
    await db.delete(guest_sessions).where(inArray(guest_sessions.id, visitorIds));
  }

  if (dramaIds.length > 0) {
    await db
      .delete(playback_analytics_events)
      .where(inArray(playback_analytics_events.drama_id, dramaIds));
    await db
      .delete(content_view_events)
      .where(inArray(content_view_events.content_id, dramaIds));
  }

  if (dramaIds.length > 0) {
    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(inArray(episodes.drama_id, dramaIds));
    const episodeIds = episodeRows.map(row => row.id);

    if (episodeIds.length > 0) {
      await db
        .delete(playback_viewing_sessions)
        .where(inArray(playback_viewing_sessions.content_id, dramaIds));
      await db
        .delete(playback_analytics_events)
        .where(inArray(playback_analytics_events.episode_id, episodeIds));
      await db.delete(episodes).where(inArray(episodes.id, episodeIds));
    }

    const seasonRows = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(inArray(seasons.drama_id, dramaIds));

    await db
      .delete(seasons)
      .where(inArray(seasons.id, seasonRows.map(row => row.id)));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
}

describe('analytics visitor reconciliation', () => {
  let seeded: Seed;

  beforeEach(async () => {
    await cleanupR5s1Fixtures();
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
    await cleanupR5s1Fixtures();
  });

  afterAll(async () => {
    await cleanupR5s1Fixtures();
    await closePool();
  });

  it('moves the browser guest view event to the account canonical visitor', async () => {
    const canonical = await insertCanonicalVisitor(seeded.userId);
    const eventId = randomUUID();

    await db.insert(content_view_events).values({
      id: eventId,
      guest_session_id: seeded.guestRowId,
      viewer_type: 'guest',
      content_id: seeded.dramaId,
      content_type: 'drama',
      drama_id: seeded.dramaId,
      viewed_at: EVENT_AT,
      viewed_hour_bucket: HOUR_BUCKET,
    });

    const visitor = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    expect(visitor).toEqual({
      guestSessionId: canonical.rowId,
      sessionId: canonical.sessionId,
      userId: seeded.userId,
    });

    const [event] = await db
      .select({ guestSessionId: content_view_events.guest_session_id })
      .from(content_view_events)
      .where(eq(content_view_events.id, eventId));

    expect(event?.guestSessionId).toBe(canonical.rowId);

    const [guest] = await db
      .select({ deletedAt: guest_sessions.deleted_at })
      .from(guest_sessions)
      .where(eq(guest_sessions.id, seeded.guestRowId));

    expect(guest?.deletedAt).not.toBeNull();
  });

  it('moves the browser guest playback event to the account canonical visitor', async () => {
    const canonical = await insertCanonicalVisitor(seeded.userId);
    const eventId = randomUUID();

    await db.insert(playback_analytics_events).values({
      id: eventId,
      guest_session_id: seeded.guestRowId,
      viewer_type: 'guest',
      content_id: seeded.episodeId,
      content_type: 'drama',
      drama_id: seeded.dramaId,
      episode_id: seeded.episodeId,
      event_type: 'play',
      position_seconds: 0,
      watch_duration_seconds: 30,
      event_at: EVENT_AT,
      event_hour_bucket: HOUR_BUCKET,
    });

    const visitor = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    expect(visitor.guestSessionId).toBe(canonical.rowId);

    const [event] = await db
      .select({ guestSessionId: playback_analytics_events.guest_session_id })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.id, eventId));

    expect(event?.guestSessionId).toBe(canonical.rowId);

    const [guest] = await db
      .select({ deletedAt: guest_sessions.deleted_at })
      .from(guest_sessions)
      .where(eq(guest_sessions.id, seeded.guestRowId));

    expect(guest?.deletedAt).not.toBeNull();
  });

  it('keeps one merged playback event when the canonical visitor already has the same bucket', async () => {
    const canonical = await insertCanonicalVisitor(seeded.userId);
    const canonicalEventId = randomUUID();
    const guestEventId = randomUUID();

    await db.insert(playback_analytics_events).values([
      {
        id: canonicalEventId,
        guest_session_id: canonical.rowId,
        viewer_type: 'authenticated',
        content_id: seeded.episodeId,
        content_type: 'drama',
        drama_id: seeded.dramaId,
        episode_id: seeded.episodeId,
        event_type: 'play',
        position_seconds: 0,
        watch_duration_seconds: 30,
        event_at: new Date('2026-11-27T10:05:00.000Z'),
        event_hour_bucket: HOUR_BUCKET,
      },
      {
        id: guestEventId,
        guest_session_id: seeded.guestRowId,
        viewer_type: 'guest',
        // The typed target is authoritative (D-032): this row collides with
        // the canonical playback event even though its legacy pair disagrees.
        content_id: randomUUID(),
        content_type: 'movie',
        drama_id: seeded.dramaId,
        episode_id: seeded.episodeId,
        event_type: 'play',
        position_seconds: 0,
        watch_duration_seconds: 30,
        event_at: EVENT_AT,
        event_hour_bucket: HOUR_BUCKET,
      },
    ]);

    await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    const activeEvents = await db
      .select({ id: playback_analytics_events.id })
      .from(playback_analytics_events)
      .where(
        and(
          eq(playback_analytics_events.drama_id, seeded.dramaId),
          isNull(playback_analytics_events.deleted_at)
        )
      );

    expect(activeEvents).toHaveLength(1);
    expect(activeEvents[0]?.id).toBe(canonicalEventId);

    const [guestEvent] = await db
      .select({
        guestSessionId: playback_analytics_events.guest_session_id,
        deletedAt: playback_analytics_events.deleted_at,
      })
      .from(playback_analytics_events)
      .where(eq(playback_analytics_events.id, guestEventId));

    expect(guestEvent?.guestSessionId).toBe(canonical.rowId);
    expect(guestEvent?.deletedAt).not.toBeNull();
  });

  it('moves the browser guest viewing-session baseline to the account canonical visitor', async () => {
    const canonical = await insertCanonicalVisitor(seeded.userId);
    const baselineId = randomUUID();

    await db.insert(playback_viewing_sessions).values({
      id: baselineId,
      guest_session_id: seeded.guestRowId,
      content_id: seeded.dramaId,
      content_type: 'drama',
      drama_id: seeded.dramaId,
      client_session_key: `client-${randomUUID()}`,
      started_at: EVENT_AT,
      last_event_at: EVENT_AT,
      last_cumulative_watch_seconds: 30,
    });

    const visitor = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    expect(visitor.guestSessionId).toBe(canonical.rowId);

    const [baseline] = await db
      .select({ guestSessionId: playback_viewing_sessions.guest_session_id })
      .from(playback_viewing_sessions)
      .where(eq(playback_viewing_sessions.id, baselineId));

    expect(baseline?.guestSessionId).toBe(canonical.rowId);

    const [guest] = await db
      .select({ deletedAt: guest_sessions.deleted_at })
      .from(guest_sessions)
      .where(eq(guest_sessions.id, seeded.guestRowId));

    expect(guest?.deletedAt).not.toBeNull();
  });

  it('keeps one merged viewing-session baseline when the canonical visitor already has the session', async () => {
    const canonical = await insertCanonicalVisitor(seeded.userId);
    const clientSessionKey = `client-${randomUUID()}`;
    const canonicalBaselineId = randomUUID();
    const guestBaselineId = randomUUID();

    await db.insert(playback_viewing_sessions).values([
      {
        id: canonicalBaselineId,
        guest_session_id: canonical.rowId,
        content_id: seeded.dramaId,
        content_type: 'drama',
        drama_id: seeded.dramaId,
        client_session_key: clientSessionKey,
        started_at: new Date('2026-11-27T10:05:00.000Z'),
        last_event_at: new Date('2026-11-27T10:05:00.000Z'),
        last_cumulative_watch_seconds: 30,
      },
      {
        id: guestBaselineId,
        guest_session_id: seeded.guestRowId,
        content_id: seeded.dramaId,
        content_type: 'drama',
        drama_id: seeded.dramaId,
        client_session_key: clientSessionKey,
        started_at: EVENT_AT,
        last_event_at: EVENT_AT,
        last_cumulative_watch_seconds: 30,
      },
    ]);

    await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    const activeBaselines = await db
      .select({ id: playback_viewing_sessions.id })
      .from(playback_viewing_sessions)
      .where(
        and(
          eq(playback_viewing_sessions.content_id, seeded.dramaId),
          isNull(playback_viewing_sessions.deleted_at)
        )
      );

    expect(activeBaselines).toHaveLength(1);
    expect(activeBaselines[0]?.id).toBe(canonicalBaselineId);

    const [guestBaseline] = await db
      .select({
        guestSessionId: playback_viewing_sessions.guest_session_id,
        deletedAt: playback_viewing_sessions.deleted_at,
      })
      .from(playback_viewing_sessions)
      .where(eq(playback_viewing_sessions.id, guestBaselineId));

    expect(guestBaseline?.guestSessionId).toBe(canonical.rowId);
    expect(guestBaseline?.deletedAt).not.toBeNull();
  });

  it('moves the browser guest search event to the account canonical visitor', async () => {
    const canonical = await insertCanonicalVisitor(seeded.userId);
    const eventId = randomUUID();

    await db.insert(search_events).values({
      id: eventId,
      guest_session_id: seeded.guestRowId,
      query_text: 'visitor reconciliation',
      result_count: 1,
      searched_at: EVENT_AT,
      search_hour_bucket: HOUR_BUCKET,
    });

    const visitor = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    expect(visitor.guestSessionId).toBe(canonical.rowId);

    const [event] = await db
      .select({ guestSessionId: search_events.guest_session_id })
      .from(search_events)
      .where(eq(search_events.id, eventId));

    expect(event?.guestSessionId).toBe(canonical.rowId);
  });

  it('keeps one merged view when the canonical visitor already has the same title and hour', async () => {
    const canonical = await insertCanonicalVisitor(seeded.userId);
    const canonicalEventId = randomUUID();
    const guestEventId = randomUUID();

    await db.insert(content_view_events).values([
      {
        id: canonicalEventId,
        guest_session_id: canonical.rowId,
        viewer_type: 'authenticated',
        content_id: seeded.dramaId,
        content_type: 'drama',
        drama_id: seeded.dramaId,
        viewed_at: new Date('2026-11-27T10:05:00.000Z'),
        viewed_hour_bucket: HOUR_BUCKET,
      },
      {
        id: guestEventId,
        guest_session_id: seeded.guestRowId,
        viewer_type: 'guest',
        // The typed target is authoritative (D-032): this row collides with
        // the canonical view even though its legacy pair names a movie.
        content_id: randomUUID(),
        content_type: 'movie',
        drama_id: seeded.dramaId,
        viewed_at: EVENT_AT,
        viewed_hour_bucket: HOUR_BUCKET,
      },
    ]);

    await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    const activeViews = await db
      .select({ id: content_view_events.id })
      .from(content_view_events)
      .where(
        and(
          eq(content_view_events.drama_id, seeded.dramaId),
          isNull(content_view_events.deleted_at)
        )
      );

    expect(activeViews).toHaveLength(1);
    expect(activeViews[0]?.id).toBe(canonicalEventId);

    const [guestEvent] = await db
      .select({ deletedAt: content_view_events.deleted_at })
      .from(content_view_events)
      .where(eq(content_view_events.id, guestEventId));

    expect(guestEvent?.deletedAt).not.toBeNull();
  });

  it('does not reconcile the retired browser guest row twice', async () => {
    const canonical = await insertCanonicalVisitor(seeded.userId);
    const eventId = randomUUID();

    await db.insert(content_view_events).values({
      id: eventId,
      guest_session_id: seeded.guestRowId,
      viewer_type: 'guest',
      content_id: seeded.dramaId,
      content_type: 'drama',
      drama_id: seeded.dramaId,
      viewed_at: EVENT_AT,
      viewed_hour_bucket: HOUR_BUCKET,
    });

    const first = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });
    const second = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    expect(first.guestSessionId).toBe(canonical.rowId);
    expect(second.guestSessionId).toBe(canonical.rowId);

    const [event] = await db
      .select({ guestSessionId: content_view_events.guest_session_id })
      .from(content_view_events)
      .where(eq(content_view_events.id, eventId));

    expect(event?.guestSessionId).toBe(canonical.rowId);

    const [guest] = await db
      .select({ deletedAt: guest_sessions.deleted_at })
      .from(guest_sessions)
      .where(eq(guest_sessions.id, seeded.guestRowId));

    expect(guest?.deletedAt).not.toBeNull();
  });

  it('still links the browser guest row when the account has no canonical row', async () => {
    const visitor = await resolveAnalyticsVisitor({
      userId: seeded.userId,
      sessionId: seeded.guestSessionId,
    });

    expect(visitor).toEqual({
      guestSessionId: seeded.guestRowId,
      sessionId: seeded.guestSessionId,
      userId: seeded.userId,
    });

    const [guest] = await db
      .select({
        userId: guest_sessions.user_id,
        deletedAt: guest_sessions.deleted_at,
      })
      .from(guest_sessions)
      .where(eq(guest_sessions.id, seeded.guestRowId));

    expect(guest?.userId).toBe(seeded.userId);
    expect(guest?.deletedAt).toBeNull();
  });
});
