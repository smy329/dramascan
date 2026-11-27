import { describe, expect, it } from 'vitest';

import { parseAnalyticsPlaybackInput } from '@/modules/analytics/analytics-inputs';

/**
 * The playback request contract (D-070, D-090).
 *
 * The beacon is public, so the contract decides what a client may assert.
 * Two assertions matter here: only a completion event may claim that the
 * viewer reached the end of a title, and every beacon names the viewing
 * session it reports for — the server keeps a baseline per session, so a
 * beacon without a key has nowhere to be measured against.
 */

const TARGET = {
  episodeId: '11111111-1111-4111-8111-111111111111',
  dramaId: '22222222-2222-4222-8222-222222222222',
};

const SESSION = { clientSessionKey: 'session-key-1' };

describe('parseAnalyticsPlaybackInput', () => {
  it('accepts a completion event that claims the threshold was met', () => {
    const parsed = parseAnalyticsPlaybackInput({
      ...TARGET,
      ...SESSION,
      eventType: 'completion',
      completionThresholdMet: true,
    });

    expect(parsed.completionThresholdMet).toBe(true);
  });

  it('refuses a completion claim on any other event', () => {
    for (const eventType of ['play', 'play_pause', 'seek', 'exit'] as const) {
      const parsed = parseAnalyticsPlaybackInput({
        ...TARGET,
        ...SESSION,
        eventType,
        completionThresholdMet: true,
      });

      expect(parsed.completionThresholdMet, eventType).toBe(false);
    }
  });

  it('keeps a completion event that does not claim the threshold', () => {
    const parsed = parseAnalyticsPlaybackInput({
      ...TARGET,
      ...SESSION,
      eventType: 'completion',
      completionThresholdMet: false,
    });

    expect(parsed.completionThresholdMet).toBe(false);
  });

  it('accepts the cumulative watch time of the viewing session', () => {
    const parsed = parseAnalyticsPlaybackInput({
      ...TARGET,
      ...SESSION,
      eventType: 'play_pause',
      cumulativeWatchSeconds: 120,
    });

    expect(parsed.cumulativeWatchSeconds).toBe(120);
    expect(parsed.clientSessionKey).toBe('session-key-1');
  });

  it('requires the key of the viewing session', () => {
    // Without the key the server has no baseline to measure the claim
    // against, and two tabs would share one baseline.
    expect(() =>
      parseAnalyticsPlaybackInput({ ...TARGET, eventType: 'play', cumulativeWatchSeconds: 10 })
    ).toThrow();
  });

  it('rejects a beacon that names no target', () => {
    expect(() =>
      parseAnalyticsPlaybackInput({ ...SESSION, eventType: 'play', cumulativeWatchSeconds: 10 })
    ).toThrow();
  });

  it('rejects a negative watch time', () => {
    expect(() =>
      parseAnalyticsPlaybackInput({
        ...TARGET,
        ...SESSION,
        eventType: 'play',
        cumulativeWatchSeconds: -1,
      })
    ).toThrow();
  });

  it('rejects a beacon that names a movie and an episode at the same time', () => {
    // The contract says "exactly one target". A payload that names both is
    // ambiguous, and the server would have to guess which one it meant.
    expect(() =>
      parseAnalyticsPlaybackInput({
        ...SESSION,
        eventType: 'play',
        movieId: '33333333-3333-4333-8333-333333333333',
        episodeId: TARGET.episodeId,
        dramaId: TARGET.dramaId,
      })
    ).toThrow();
  });

  it('rejects a beacon that names a movie with an episode of a drama', () => {
    expect(() =>
      parseAnalyticsPlaybackInput({
        ...SESSION,
        eventType: 'play',
        movieId: '33333333-3333-4333-8333-333333333333',
        episodeId: TARGET.episodeId,
      })
    ).toThrow();
  });

  it('rejects a beacon that names a movie with a drama', () => {
    expect(() =>
      parseAnalyticsPlaybackInput({
        ...SESSION,
        eventType: 'play',
        movieId: '33333333-3333-4333-8333-333333333333',
        dramaId: TARGET.dramaId,
      })
    ).toThrow();
  });
});
