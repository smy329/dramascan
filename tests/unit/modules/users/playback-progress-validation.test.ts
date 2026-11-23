import { describe, expect, it } from 'vitest';

import {
  parseBookmarkTarget,
  parseEpisodeWatchedStateInput,
  parsePlaybackProgressInput,
} from '@/modules/users/validation';

/**
 * The viewer's own progress input.
 *
 * A report names exactly one playable item: an episode or a standalone movie.
 * An episode report also names the version of the source it was watching, so a
 * report that belongs to a replaced source can be ignored.
 */
const EPISODE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const MOVIE_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('parsePlaybackProgressInput', () => {
  it('accepts an episode report', () => {
    const parsed = parsePlaybackProgressInput({
      episodeId: EPISODE_ID,
      positionSeconds: 120,
      durationSeconds: 1000,
      watchedAt: '2026-01-02T10:00:00.000Z',
      sourceVersion: 1,
    });

    expect(parsed.episodeId).toBe(EPISODE_ID);
    expect(parsed.sourceVersion).toBe(1);
  });

  it('accepts a movie report without a source version', () => {
    const parsed = parsePlaybackProgressInput({
      movieId: MOVIE_ID,
      positionSeconds: 120,
      durationSeconds: 1000,
      watchedAt: '2026-01-02T10:00:00.000Z',
    });

    expect(parsed.movieId).toBe(MOVIE_ID);
    expect(parsed.episodeId).toBeUndefined();
  });

  it('rejects a report without a target', () => {
    expect(() =>
      parsePlaybackProgressInput({
        positionSeconds: 120,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
        sourceVersion: 1,
      })
    ).toThrow();
  });

  it('rejects a report that names both an episode and a movie', () => {
    expect(() =>
      parsePlaybackProgressInput({
        episodeId: EPISODE_ID,
        movieId: MOVIE_ID,
        positionSeconds: 120,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
        sourceVersion: 1,
      })
    ).toThrow();
  });

  it('rejects an episode report without a source version', () => {
    expect(() =>
      parsePlaybackProgressInput({
        episodeId: EPISODE_ID,
        positionSeconds: 120,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
      })
    ).toThrow();
  });

  it('rejects a position beyond the duration', () => {
    expect(() =>
      parsePlaybackProgressInput({
        episodeId: EPISODE_ID,
        positionSeconds: 5000,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
        sourceVersion: 1,
      })
    ).toThrow();
  });

  it('rejects an unknown key', () => {
    expect(() =>
      parsePlaybackProgressInput({
        episodeId: EPISODE_ID,
        positionSeconds: 120,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
        sourceVersion: 1,
        userId: 'someone-else',
      })
    ).toThrow();
  });
});

describe('parseBookmarkTarget', () => {
  it('accepts a drama target', () => {
    expect(parseBookmarkTarget({ type: 'drama', id: EPISODE_ID })).toEqual({
      type: 'drama',
      id: EPISODE_ID,
    });
  });

  it('accepts a movie target', () => {
    expect(parseBookmarkTarget({ type: 'movie', id: MOVIE_ID })).toEqual({
      type: 'movie',
      id: MOVIE_ID,
    });
  });

  it('rejects an unknown content type', () => {
    expect(() => parseBookmarkTarget({ type: 'episode', id: EPISODE_ID })).toThrow();
  });

  it('rejects an id that is not a uuid', () => {
    expect(() => parseBookmarkTarget({ type: 'drama', id: 'not-a-uuid' })).toThrow();
  });
});

describe('parseEpisodeWatchedStateInput', () => {
  it('accepts a watched change', () => {
    expect(parseEpisodeWatchedStateInput({ episodeId: EPISODE_ID, watched: true })).toEqual({
      episodeId: EPISODE_ID,
      watched: true,
    });
  });

  it('rejects a missing state', () => {
    expect(() => parseEpisodeWatchedStateInput({ episodeId: EPISODE_ID })).toThrow();
  });
});
