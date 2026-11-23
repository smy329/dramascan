import { describe, expect, it } from 'vitest';

import { parseServerConfig } from '@/platform/config/schema';

/**
 * The playback completion threshold.
 *
 * One value decides when an episode counts as watched. The server applies it
 * when it stores the watched state, and the watch page hands the same value to
 * the player, so the client and the server never apply divergent rules.
 */
function parseDevelopment(overrides: Record<string, string | undefined>) {
  return parseServerConfig({ NODE_ENV: 'development', ...overrides });
}

describe('PLAYBACK_COMPLETION_THRESHOLD_PERCENT', () => {
  it('defaults to 90 percent', () => {
    const config = parseDevelopment({});

    expect(config.playbackCompletionThresholdPercent).toBe(90);
  });

  it('uses the configured value', () => {
    const config = parseDevelopment({ PLAYBACK_COMPLETION_THRESHOLD_PERCENT: '75' });

    expect(config.playbackCompletionThresholdPercent).toBe(75);
  });

  it('accepts the boundaries of the range', () => {
    expect(parseDevelopment({ PLAYBACK_COMPLETION_THRESHOLD_PERCENT: '1' })
      .playbackCompletionThresholdPercent).toBe(1);
    expect(parseDevelopment({ PLAYBACK_COMPLETION_THRESHOLD_PERCENT: '100' })
      .playbackCompletionThresholdPercent).toBe(100);
  });

  it('rejects a value below one percent', () => {
    expect(() => parseDevelopment({ PLAYBACK_COMPLETION_THRESHOLD_PERCENT: '0' })).toThrow(
      /PLAYBACK_COMPLETION_THRESHOLD_PERCENT/
    );
  });

  it('rejects a value above one hundred percent', () => {
    expect(() => parseDevelopment({ PLAYBACK_COMPLETION_THRESHOLD_PERCENT: '101' })).toThrow(
      /PLAYBACK_COMPLETION_THRESHOLD_PERCENT/
    );
  });

  it('rejects a fractional value', () => {
    expect(() => parseDevelopment({ PLAYBACK_COMPLETION_THRESHOLD_PERCENT: '12.5' })).toThrow(
      /PLAYBACK_COMPLETION_THRESHOLD_PERCENT/
    );
  });
});
