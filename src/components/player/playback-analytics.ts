'use client';

import {
  PLAYBACK_EVENT_TYPES,
  type PlaybackEventTarget,
  type PlaybackEventType,
} from '@/modules/analytics/playback-events.shared';

/**
 * The playback analytics reporter (Prompts 141, 142, D-090).
 *
 * The player reports four kinds of event — play/pause, seek, completion, and
 * exit — and the server turns them into bounded analytics rows.
 *
 * Three properties matter:
 *
 *   - **The watch time is a cumulative claim.** Every event carries the
 *     seconds the viewer accumulated since the *start of the viewing session*,
 *     not since the last event. The server keeps the cumulative watch time it
 *     has already accounted for, so it can tell a repeated claim from a new
 *     one. A delta protocol could not: the first beacon of a session had no
 *     previous event to measure against, and an event whose acknowledgement
 *     was lost was counted twice.
 *   - **The viewing session has its own key.** Two tabs of the same viewer
 *     are two viewing sessions, so their claims do not interfere.
 *   - **A report never interrupts playback.** The reporter is fire-and-forget:
 *     a failed request is ignored and the watch time stays pending.
 *
 * The reports are serialised. One report is in flight at a time, so the
 * confirmations arrive in the order the events were sent.
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
  /** The watch seconds the server has not confirmed yet. */
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
 * @param input.clientSessionKey the key of the viewing session; one is
 *   generated when the caller provides none
 * @returns the reporter
 */
export function createPlaybackAnalyticsReporter(input: {
  target: PlaybackAnalyticsTarget;
  fetchImpl?: typeof fetch;
  clientSessionKey?: string;
}): PlaybackAnalyticsReporter {
  const doFetch = input.fetchImpl ?? fetch;
  const clientSessionKey = input.clientSessionKey ?? createClientSessionKey();

  // The cumulative watch time of the viewing session, and the part of it the
  // server has confirmed. The difference is the watch time that is still
  // waiting to be stored.
  let cumulativeWatchSeconds = 0;
  let confirmedWatchSeconds = 0;
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

    cumulativeWatchSeconds += delta;
  };

  const report = (
    eventType: PlaybackAnalyticsEventType,
    detail?: { positionSeconds?: number; completionThresholdMet?: boolean }
  ) => {
    chain = chain
      .then(async () => {
        const payload =
          input.target.type === 'drama'
            ? {
                eventType,
                episodeId: input.target.episodeId,
                dramaId: input.target.dramaId,
                positionSeconds: detail?.positionSeconds ?? null,
                cumulativeWatchSeconds: Math.round(cumulativeWatchSeconds),
                clientSessionKey,
                completionThresholdMet: detail?.completionThresholdMet ?? false,
              }
            : {
                eventType,
                movieId: input.target.movieId,
                positionSeconds: detail?.positionSeconds ?? null,
                cumulativeWatchSeconds: Math.round(cumulativeWatchSeconds),
                clientSessionKey,
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
          data?: { recorded?: boolean; duplicate?: boolean; accountedWatchSeconds?: number };
        };

        // The server reports the cumulative watch time it has accounted for.
        // A dropped event does not advance it, so the watch time stays pending
        // and the next event carries it.
        const accounted = body.data?.accountedWatchSeconds;

        if (typeof accounted === 'number' && Number.isFinite(accounted)) {
          confirmedWatchSeconds = Math.max(confirmedWatchSeconds, accounted);
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
    pendingWatchSeconds: () => Math.max(0, cumulativeWatchSeconds - confirmedWatchSeconds),
  };
}

/**
 * The key of a viewing session.
 *
 * The key separates two tabs of the same viewer: their claims are counted
 * against two baselines, so one tab cannot reset the baseline of the other.
 *
 * @returns the key
 */
function createClientSessionKey(): string {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));

    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
