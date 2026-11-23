import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Episode video-source replacement integration coverage.
 *
 * Replacing an episode's source is the one administrative action that changes
 * what every viewer receives. It therefore has to be a single unit of work:
 * the new source is stored, every viewer's playback position goes back to the
 * beginning, the episode reads as unwatched, and an operational record is
 * written. If any of those fail, none of them may have happened — a source
 * that changed without a reset would leave viewers resuming in the middle of a
 * different video, and a reset without a record would be an unexplained
 * change.
 *
 * The watch history survives: it records what somebody watched and when, and
 * replacing a source does not rewrite the past.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for episode video source integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { admin_audit_log } from '@/modules/administration/schema';
import { userActor } from '@/modules/authorization/actors';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { playback_progress, watch_history, watched_state } from '@/modules/users/schema';
import { closePool } from '@/platform/db/pool';
import { replaceEpisodeVideoSource, updateEpisode } from '@/workflows/admin/episodes';

const TEST_PREFIX = 'it-video-source-';
const ORIGINAL_SOURCE = 'https://media.example.com/episodes/original.mp4';
const REPLACEMENT_SOURCE = 'https://media.example.com/episodes/replacement.mp4';

/**
 * A replacement payload.
 *
 * The browser preview verified the new URL and the administrator confirmed the
 * replacement; that confirmation travels with the payload.
 */
function replacementPayload(): { videoSource: string; previewConfirmed: boolean } {
  return { videoSource: REPLACEMENT_SOURCE, previewConfirmed: true };
}

type Seed = {
  adminId: string;
  viewerId: string;
  dramaId: string;
  seasonId: string;
  episodeId: string;
  otherEpisodeId: string;
};

async function seed(): Promise<Seed> {
  const adminId = randomUUID();
  const viewerId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const otherEpisodeId = randomUUID();

  await db.insert(users).values([
    {
      id: adminId,
      name: 'Source admin',
      email: `${TEST_PREFIX}admin-${randomUUID().slice(0, 8)}@example.com`,
      isSuperAdmin: true,
    },
    {
      id: viewerId,
      name: 'Source viewer',
      email: `${TEST_PREFIX}viewer-${randomUUID().slice(0, 8)}@example.com`,
    },
  ]);

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Source drama',
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

  await db.insert(episodes).values([
    {
      id: episodeId,
      drama_id: dramaId,
      season_id: seasonId,
      title: 'Episode 1',
      description: 'The original description.',
      episode_number: 1,
      position: 0,
      publication_status: 'published',
      video_source: ORIGINAL_SOURCE,
    },
    {
      id: otherEpisodeId,
      drama_id: dramaId,
      season_id: seasonId,
      title: 'Episode 2',
      episode_number: 2,
      position: 1,
      publication_status: 'published',
      video_source: 'https://media.example.com/episodes/other.mp4',
    },
  ]);

  await db.insert(playback_progress).values({
    user_id: viewerId,
    content_type: 'drama',
    content_id: dramaId,
    drama_id: dramaId,
    episode_id: episodeId,
    position: 600,
    duration: 2400,
    completed: true,
  });

  await db.insert(watched_state).values({
    user_id: viewerId,
    content_type: 'drama',
    content_id: dramaId,
    drama_id: dramaId,
    episode_id: episodeId,
    watched_minutes: 45,
    threshold_met: true,
    completed_at: new Date('2026-01-01T00:00:00.000Z'),
  });

  await db.insert(watch_history).values({
    user_id: viewerId,
    content_type: 'drama',
    content_id: dramaId,
    drama_id: dramaId,
    episode_id: episodeId,
    watched_at: new Date('2026-01-01T12:00:00.000Z'),
    watch_duration: 45,
  });

  return { adminId, viewerId, dramaId, seasonId, episodeId, otherEpisodeId };
}

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_PREFIX}%`));

  const dramaIds = rows.map(row => row.id);

  if (dramaIds.length > 0) {
    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(inArray(episodes.drama_id, dramaIds));

    const episodeIds = episodeRows.map(row => row.id);

    if (episodeIds.length > 0) {
      await db.delete(playback_progress).where(inArray(playback_progress.episode_id, episodeIds));
      await db.delete(watched_state).where(inArray(watched_state.episode_id, episodeIds));
      await db.delete(watch_history).where(inArray(watch_history.episode_id, episodeIds));
      await db.delete(episodes).where(inArray(episodes.id, episodeIds));
    }

    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  await db
    .delete(admin_audit_log)
    .where(inArray(admin_audit_log.entity_type, ['episode']));
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

describe('replaceEpisodeVideoSource', () => {
  it('stores the new source', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    const result = await replaceEpisodeVideoSource(actor, seeded.episodeId, replacementPayload());

    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, seeded.episodeId));

    expect(row?.video_source).toBe(REPLACEMENT_SOURCE);
  });

  it('moves the source version on, so a position of the old source is ignored', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    const [before] = await db
      .select({ version: episodes.video_source_version })
      .from(episodes)
      .where(eq(episodes.id, seeded.episodeId));

    expect(before?.version).toBe(1);

    await replaceEpisodeVideoSource(actor, seeded.episodeId, replacementPayload());

    const [after] = await db
      .select({ version: episodes.video_source_version })
      .from(episodes)
      .where(eq(episodes.id, seeded.episodeId));

    expect(after?.version).toBe(2);
  });

  it('refuses a replacement without the preview confirmation', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await expect(
      replaceEpisodeVideoSource(actor, seeded.episodeId, {
        videoSource: REPLACEMENT_SOURCE,
        previewConfirmed: false,
      })
    ).rejects.toThrow();

    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, seeded.episodeId));

    expect(row?.video_source).toBe(ORIGINAL_SOURCE);
  });

  it('preserves the rest of the episode', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await replaceEpisodeVideoSource(actor, seeded.episodeId, replacementPayload());

    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, seeded.episodeId));

    expect(row).toMatchObject({
      id: seeded.episodeId,
      drama_id: seeded.dramaId,
      season_id: seeded.seasonId,
      title: 'Episode 1',
      description: 'The original description.',
      episode_number: 1,
      publication_status: 'published',
    });
  });

  it('resets the playback position and the watched state', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await replaceEpisodeVideoSource(actor, seeded.episodeId, replacementPayload());

    const [progress] = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    expect(progress?.position).toBe(0);
    expect(progress?.completed).toBe(false);

    const [watched] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(watched?.threshold_met).toBe(false);
    expect(watched?.watched_minutes).toBe(0);
    expect(watched?.completed_at).toBeNull();
  });

  it('preserves the watch history and its historical date', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await replaceEpisodeVideoSource(actor, seeded.episodeId, replacementPayload());

    const rows = await db
      .select()
      .from(watch_history)
      .where(eq(watch_history.episode_id, seeded.episodeId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.watched_at?.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(rows[0]?.watch_duration).toBe(45);
  });

  it('writes one operational record that does not contain the source URL', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await replaceEpisodeVideoSource(actor, seeded.episodeId, replacementPayload());

    const rows = await db
      .select()
      .from(admin_audit_log)
      .where(eq(admin_audit_log.entity_id, seeded.episodeId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: seeded.adminId,
      action: 'episode.video_source.replaced',
      entity_type: 'episode',
    });
    expect(JSON.stringify(rows[0])).not.toContain('media.example.com');
  });

  it('does not affect another episode', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await replaceEpisodeVideoSource(actor, seeded.episodeId, replacementPayload());

    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, seeded.otherEpisodeId));

    expect(row?.video_source).toBe('https://media.example.com/episodes/other.mp4');
  });

  it('rejects a source that is not an HTTPS MP4 URL', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await expect(
      replaceEpisodeVideoSource(actor, seeded.episodeId, {
        videoSource: 'http://media.example.com/episode.mp4',
        previewConfirmed: true,
      })
    ).rejects.toThrow();

    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, seeded.episodeId));

    expect(row?.video_source).toBe(ORIGINAL_SOURCE);
  });

  it('rolls the whole replacement back when the operational record cannot be written', async () => {
    const seeded = await seed();
    // The audit row references `users`; an actor id that does not exist makes
    // the insert fail, which must roll the source update and the progress
    // reset back with it.
    const actor = userActor(randomUUID(), { isSuperAdmin: true });

    await expect(
      replaceEpisodeVideoSource(actor, seeded.episodeId, replacementPayload())
    ).rejects.toThrow();

    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, seeded.episodeId));

    expect(row?.video_source).toBe(ORIGINAL_SOURCE);

    const [progress] = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    expect(progress?.position).toBe(600);
    expect(progress?.completed).toBe(true);

    const [watched] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(watched?.threshold_met).toBe(true);
  });
});

describe('updateEpisode', () => {
  it('refuses to change the video source', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await expect(
      updateEpisode(actor, seeded.episodeId, { video_source: REPLACEMENT_SOURCE })
    ).rejects.toThrow();

    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, seeded.episodeId));

    expect(row?.video_source).toBe(ORIGINAL_SOURCE);
  });
});
