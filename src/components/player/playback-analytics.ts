'use client';

import {
  PLAYBACK_EVENT_TYPES,
  type PlaybackEventTarget,
  type PlaybackEventType,
} from '@/modules/analytics/playback-events.shared';

/**
 * The playback analytics reporter (Prompts 141, 142).
 *
 * The player reports four kinds of event — play/pause, seek, completion, and
 * exit — and the server turns them into bounded analytics rows.
 *
 * Two properties matter:
 *
 *   - **The watch time is a delta.** Every event carries the seconds the
 *     viewer accumulated since the last event the server *stored*. The
 *     browser only clears its accumulator when the server confirms the row
 *     was written, so an event the bounded write dropped does not lose the
 *     watch time it carried: the next event carries it instead.
 *   - **A report never interrupts playback.** The reporter is fire-and-forget:
 *     a failed request is ignored and the watch time stays pending.
 *
 * The reports are serialised. One report is in flight at a time, so the
 * confirmations arrive in the order the events were sent and the accumulator
 * is never cleared twice for the same watch time.
 *
 * The event catalogue and the target shape live in a shared file, so the
 * browser reports exactly the events the server accepts (D-085).
 */

/** The events the player reports. */
export { PLAYBACK_EVENT_TYPES };

/** One playback analytics event type. */
export type PlaybackAnalyticsEventType = PlaybackEventType;

/** What the reporter sends. */
export type PlaybackAnalyticsTarget = PlaybackEventTarget;

/** The reporter's handle. */
export type PlaybackAnalyticsReporter = {
  /**
   * Add the watch time the viewer accumulated since the last observation.
   *
   * The caller passes the media position and whether the media is playing.
   * A seek produces a large jump in the position; the jump is not watch time
   * and is discarded.
   *
   * @param positionSeconds the media position
   * @param isPlaying whether the media is playing
   */
  observe: (_positionSeconds: number, _isPlaying: boolean) => void;
  /**
   * Report an event.
   *
   * @param eventType the event
   * @param detail the position, and whether the completion threshold was met
   */
  report: (
    _eventType: PlaybackAnalyticsEventType,
    _detail?: { positionSeconds?: number; completionThresholdMet?: boolean }
  ) => void;
  /** The watch seconds that are still waiting to be stored. */
  pendingWatchSeconds: () => number;
};

/**
 * How large a position jump is still treated as watch time.
 *
 * The media reports its position several times a second, so a jump of a few
 * seconds is ordinary playback. A larger jump is a seek: the viewer moved
 * somewhere else, and the time between the two positions was not watched.
 */
const MAX_WATCH_DELTA_SECONDS = 5;

/**
 * Create the playback analytics reporter.
 *
 * @param target what is being played
 * @returns the reporter
 */
export function createPlaybackAnalyticsReporter(input: {
  target: PlaybackAnalyticsTarget;
  fetchImpl?: typeof fetch;
}): PlaybackAnalyticsReporter {
  const doFetch = input.fetchImpl ?? fetch;

  let pendingWatchSeconds = 0;
  let lastPositionSeconds: number | null = null;
  let chain: Promise<void> = Promise.resolve();

  const observe = (positionSeconds: number, isPlaying: boolean) => {
    if (!isPlaying) {
      lastPositionSeconds = positionSeconds;
      return;
    }

    if (lastPositionSeconds === null) {
      lastPositionSeconds = positionSeconds;
      return;
    }

    const delta = positionSeconds - lastPositionSeconds;
    lastPositionSeconds = positionSeconds;

    if (delta <= 0 || delta > MAX_WATCH_DELTA_SECONDS) {
      return;
    }

    pendingWatchSeconds += delta;
  };

  const report = (
    eventType: PlaybackAnalyticsEventType,
    detail?: { positionSeconds?: number; completionThresholdMet?: boolean }
  ) => {
    chain = chain
      .then(async () => {
        const watchDurationSeconds = Math.round(pendingWatchSeconds);

        const payload =
          input.target.type === 'drama'
            ? {
                eventType,
                episodeId: input.target.episodeId,
                dramaId: input.target.dramaId,
                positionSeconds: detail?.positionSeconds ?? null,
                watchDurationSeconds,
                completionThresholdMet: detail?.completionThresholdMet ?? false,
              }
            : {
                eventType,
                movieId: input.target.movieId,
                positionSeconds: detail?.positionSeconds ?? null,
                watchDurationSeconds,
                completionThresholdMet: detail?.completionThresholdMet ?? false,
              };

        const response = await doFetch('/api/analytics/playback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        });

        if (!response.ok) {
          return;
        }

        const body = (await response.json()) as {
          data?: { recorded?: boolean; duplicate?: boolean };
        };

        if (body.data?.recorded === true) {
          // The server stored the row, so the watch time it carried is
          // accounted for. Anything that arrived in the meantime stays.
          pendingWatchSeconds = Math.max(0, pendingWatchSeconds - watchDurationSeconds);
        }
      })
      .catch(() => {
        // A failed analytics report must never interrupt playback. The watch
        // time stays pending and the next event carries it.
      });
  };

  return {
    observe,
    report,
    pendingWatchSeconds: () => pendingWatchSeconds,
  };
}
