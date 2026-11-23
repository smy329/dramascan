import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Playback module integration coverage.
 *
 * Subtitle tracks are administrator-managed metadata attached to an episode.
 * The browser fetches the subtitle file directly from the external host, so
 * the module's job is to store the metadata correctly: one track per language,
 * at most one default track per episode, and a clean removal path.
 *
 * Failure reports let an administrator see which episodes are not playing
 * without the module copying the source URL into a second table.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for playback integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import {
  deleteSubtitleTrack,
  listPlaybackFailures,
  listPublicSubtitleTracks,
  listSubtitleTracks,
  listSubtitleTracksByEpisodeIds,
  recordPlaybackFailure,
  upsertSubtitleTrack,
} from '@/modules/playback';
import { playback_failure_reports, subtitle_tracks } from '@/modules/playback/schema';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-playback-';

type Seed = {
  reporterId: string;
  dramaId: string;
  episodeId: string;
  secondEpisodeId: string;
};

async function seed(): Promise<Seed> {
  const reporterId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const secondEpisodeId = randomUUID();

  await db.insert(users).values({
    id: reporterId,
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

  await db.insert(episodes).values({
    id: secondEpisodeId,
    drama_id: dramaId,
    season_id: seasonId,
    title: 'Episode 2',
    episode_number: 2,
    position: 1,
    publication_status: 'published',
    video_source: 'https://media.example.com/episodes/2.mp4',
  });

  return { reporterId, dramaId, episodeId, secondEpisodeId };
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
      await db.delete(subtitle_tracks).where(inArray(subtitle_tracks.episode_id, episodeIds));
      await db
        .delete(playback_failure_reports)
        .where(inArray(playback_failure_reports.episode_id, episodeIds));
      await db.delete(episodes).where(inArray(episodes.id, episodeIds));
    }

    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
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

describe('subtitle tracks', () => {
  it('creates a track', async () => {
    const seeded = await seed();

    const track = await upsertSubtitleTrack({
      episodeId: seeded.episodeId,
      language: 'en',
      label: 'English',
      sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
      format: 'vtt',
      isDefault: false,
    });

    expect(track).toMatchObject({
      episodeId: seeded.episodeId,
      language: 'en',
      label: 'English',
      sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
      format: 'vtt',
      isDefault: false,
    });

    const stored = await listSubtitleTracks(seeded.episodeId);
    expect(stored).toHaveLength(1);
  });

  it('replaces the track for a language that already has one', async () => {
    const seeded = await seed();

    await upsertSubtitleTrack({
      episodeId: seeded.episodeId,
      language: 'en',
      label: 'English',
      sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
      format: 'vtt',
      isDefault: false,
    });

    const replaced = await upsertSubtitleTrack({
      episodeId: seeded.episodeId,
      language: 'en',
      label: 'English (revised)',
      sourceUrl: 'https://cdn.example.com/subs/ep1-revised.vtt',
      format: 'vtt',
      isDefault: false,
    });

    const stored = await listSubtitleTracks(seeded.episodeId);

    expect(stored).toHaveLength(1);
    expect(stored[0]?.label).toBe('English (revised)');
    expect(stored[0]?.sourceUrl).toBe('https://cdn.example.com/subs/ep1-revised.vtt');
    expect(stored[0]?.id).toBe(replaced.id);
  });

  it('demotes the previous default when another track becomes the default', async () => {
    const seeded = await seed();

    await upsertSubtitleTrack({
      episodeId: seeded.episodeId,
      language: 'en',
      label: 'English',
      sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
      format: 'vtt',
      isDefault: true,
    });

    await upsertSubtitleTrack({
      episodeId: seeded.episodeId,
      language: 'ko',
      label: 'Korean',
      sourceUrl: 'https://cdn.example.com/subs/ep1.ko.vtt',
      format: 'vtt',
      isDefault: true,
    });

    const stored = await listSubtitleTracks(seeded.episodeId);
    const defaults = stored.filter(track => track.isDefault);

    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.language).toBe('ko');
    expect(stored.find(track => track.language === 'en')?.isDefault).toBe(false);
  });

  it('deletes a track', async () => {
    const seeded = await seed();

    const track = await upsertSubtitleTrack({
      episodeId: seeded.episodeId,
      language: 'en',
      label: 'English',
      sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
      format: 'vtt',
      isDefault: false,
    });

    await deleteSubtitleTrack(seeded.episodeId, track.id);

    expect(await listSubtitleTracks(seeded.episodeId)).toHaveLength(0);
  });

  it('lists the tracks a viewer may select', async () => {
    const seeded = await seed();

    await upsertSubtitleTrack({
      episodeId: seeded.episodeId,
      language: 'en',
      label: 'English',
      sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
      format: 'vtt',
      isDefault: true,
    });

    const publicTracks = await listPublicSubtitleTracks(seeded.episodeId);

    expect(publicTracks).toHaveLength(1);
    expect(publicTracks[0]).toMatchObject({
      language: 'en',
      label: 'English',
      sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
      format: 'vtt',
      isDefault: true,
    });
  });
});

describe('playback failure reports', () => {
  it('stores a report with its reporter and reason', async () => {
    const seeded = await seed();

    const report = await recordPlaybackFailure(
      {
        episodeId: seeded.episodeId,
        reason: 'network',
        detail: 'The media request failed.',
      },
      seeded.reporterId
    );

    expect(report.id).toBeTruthy();

    const rows = await db
      .select()
      .from(playback_failure_reports)
      .where(eq(playback_failure_reports.episode_id, seeded.episodeId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reported_by: seeded.reporterId,
      reason: 'network',
      detail: 'The media request failed.',
    });
  });

  it('accepts an anonymous report', async () => {
    const seeded = await seed();

    await recordPlaybackFailure(
      {
        episodeId: seeded.episodeId,
        reason: 'unknown',
      },
      null
    );

    const [row] = await db
      .select()
      .from(playback_failure_reports)
      .where(eq(playback_failure_reports.episode_id, seeded.episodeId));

    expect(row?.reported_by).toBeNull();
  });

  it('never stores the source URL', async () => {
    const seeded = await seed();

    await recordPlaybackFailure(
      {
        episodeId: seeded.episodeId,
        reason: 'media',
        detail: 'The player could not decode the media.',
      },
      seeded.reporterId
    );

    const [row] = await db
      .select()
      .from(playback_failure_reports)
      .where(eq(playback_failure_reports.episode_id, seeded.episodeId));

    expect(JSON.stringify(row)).not.toContain('media.example.com');
  });

  it('lists the reports of an episode, newest first', async () => {
    const seeded = await seed();

    await recordPlaybackFailure(
      {
        episodeId: seeded.episodeId,
        reason: 'network',
        detail: 'First report.',
      },
      seeded.reporterId
    );

    await recordPlaybackFailure(
      {
        episodeId: seeded.episodeId,
        reason: 'cors',
        detail: 'Second report.',
      },
      seeded.reporterId
    );

    const reports = await listPlaybackFailures({ episodeId: seeded.episodeId });

    expect(reports).toHaveLength(2);
    expect(reports[0]?.detail).toBe('Second report.');
  });
});

/**
 * The administrative pages list the playback data of every episode of a drama
 * at once. Reading the tables one episode at a time would issue one query per
 * episode, so the module offers the batch read models the pages need.
 */
describe('batch read models', () => {
  it('lists the subtitle tracks of several episodes at once', async () => {
    const seeded = await seed();

    await upsertSubtitleTrack({
      episodeId: seeded.episodeId,
      language: 'en',
      label: 'English',
      sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
      format: 'vtt',
      isDefault: true,
    });

    await upsertSubtitleTrack({
      episodeId: seeded.secondEpisodeId,
      language: 'ko',
      label: 'Korean',
      sourceUrl: 'https://cdn.example.com/subs/ep2.vtt',
      format: 'vtt',
      isDefault: false,
    });

    const tracks = await listSubtitleTracksByEpisodeIds([
      seeded.episodeId,
      seeded.secondEpisodeId,
    ]);

    expect(tracks).toHaveLength(2);
    expect(tracks.map(track => track.episodeId)).toEqual(
      expect.arrayContaining([seeded.episodeId, seeded.secondEpisodeId])
    );
  });

  it('returns no subtitle tracks for an empty episode list', async () => {
    expect(await listSubtitleTracksByEpisodeIds([])).toEqual([]);
  });

  it('lists the failure reports of several episodes at once', async () => {
    const seeded = await seed();

    await recordPlaybackFailure(
      { episodeId: seeded.episodeId, reason: 'network', detail: 'First episode failed.' },
      seeded.reporterId
    );

    await recordPlaybackFailure(
      { episodeId: seeded.secondEpisodeId, reason: 'media', detail: 'Second episode failed.' },
      seeded.reporterId
    );

    const reports = await listPlaybackFailures({
      episodeIds: [seeded.episodeId, seeded.secondEpisodeId],
    });

    expect(reports).toHaveLength(2);
    expect(reports.map(report => report.episodeId)).toEqual(
      expect.arrayContaining([seeded.episodeId, seeded.secondEpisodeId])
    );
  });

  it('does not report failures of episodes outside the requested list', async () => {
    const seeded = await seed();

    await recordPlaybackFailure(
      { episodeId: seeded.secondEpisodeId, reason: 'network' },
      seeded.reporterId
    );

    const reports = await listPlaybackFailures({ episodeIds: [seeded.episodeId] });

    expect(reports).toEqual([]);
  });
});
