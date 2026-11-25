import { describe, expect, it } from 'vitest';

import { parseAnalyticsPlaybackInput } from '@/modules/analytics/analytics-inputs';

/**
 * The playback request contract (D-070).
 *
 * The beacon is public, so the contract decides what a client may assert.
 * The one assertion that matters here is the completion: only a completion
 * event may claim that the viewer reached the end of a title.
 */

const TARGET = {
  episodeId: '11111111-1111-4111-8111-111111111111',
  dramaId: '22222222-2222-4222-8222-222222222222',
};

describe('parseAnalyticsPlaybackInput', () => {
  it('accepts a completion event that claims the threshold was met', () => {
    const parsed = parseAnalyticsPlaybackInput({
      ...TARGET,
      eventType: 'completion',
      completionThresholdMet: true,
    });

    expect(parsed.completionThresholdMet).toBe(true);
  });

  it('refuses a completion claim on any other event', () => {
    for (const eventType of ['play', 'play_pause', 'seek', 'exit'] as const) {
      const parsed = parseAnalyticsPlaybackInput({
        ...TARGET,
        eventType,
        completionThresholdMet: true,
      });

      expect(parsed.completionThresholdMet, eventType).toBe(false);
    }
  });

  it('keeps a completion event that does not claim the threshold', () => {
    const parsed = parseAnalyticsPlaybackInput({
      ...TARGET,
      eventType: 'completion',
      completionThresholdMet: false,
    });

    expect(parsed.completionThresholdMet).toBe(false);
  });

  it('rejects a beacon that names no target', () => {
    expect(() =>
      parseAnalyticsPlaybackInput({ eventType: 'play', watchDurationSeconds: 10 })
    ).toThrow();
  });

  it('rejects a negative watch time', () => {
    expect(() =>
      parseAnalyticsPlaybackInput({ ...TARGET, eventType: 'play', watchDurationSeconds: -1 })
    ).toThrow();
  });
});
