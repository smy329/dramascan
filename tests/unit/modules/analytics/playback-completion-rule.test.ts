import { describe, expect, it } from 'vitest';

import {
  COMPLETION_MINIMUM_WATCH_SECONDS,
  isCompletionSupported,
} from '@/modules/analytics/playback-plausibility';

/**
 * The server-side completion rule (D-073).
 *
 * A playback beacon is public: anybody can post to the playback endpoint. The
 * server therefore decides whether a completion claim is supported by the
 * viewer's own watch history.
 *
 * The media duration is not known to the server — no content row carries one,
 * and the duration the browser reports belongs to the user-facing playback
 * progress, which the requirements keep separate from analytics. The server can
 * therefore only support a **lower bound**: a completion counts when the
 * viewing really began and the server-verified watch time is substantial.
 */
describe('the completion support rule', () => {
  it('refuses a completion whose viewing never began', () => {
    expect(
      isCompletionSupported({
        hasPlaybackStart: false,
        cumulativeWatchSeconds: 10_000,
      })
    ).toBe(false);
  });

  it('refuses a completion without any verified watch time', () => {
    expect(
      isCompletionSupported({
        hasPlaybackStart: true,
        cumulativeWatchSeconds: 0,
      })
    ).toBe(false);
  });

  it('refuses a completion whose verified watch time is below the minimum', () => {
    expect(
      isCompletionSupported({
        hasPlaybackStart: true,
        cumulativeWatchSeconds: COMPLETION_MINIMUM_WATCH_SECONDS - 1,
      })
    ).toBe(false);
  });

  it('accepts a completion whose verified watch time reaches the minimum', () => {
    expect(
      isCompletionSupported({
        hasPlaybackStart: true,
        cumulativeWatchSeconds: COMPLETION_MINIMUM_WATCH_SECONDS,
      })
    ).toBe(true);
  });

  it('uses a minimum of one minute', () => {
    expect(COMPLETION_MINIMUM_WATCH_SECONDS).toBe(60);
  });
});
