/**
 * The playback plausibility rule (D-070).
 *
 * A playback beacon is public: anybody can post to the playback endpoint. The
 * server therefore decides what a beacon may claim, not the browser.
 *
 * Two claims are bounded here:
 *
 *   - **The watch time.** The player reports the seconds it accumulated since
 *     the last event the server stored. The watch time can never be larger
 *     than the wall-clock time between the two events, so a beacon that
 *     claims more than that is clamped. The clamp carries a small tolerance,
 *     because the browser starts counting a moment before the server stamps
 *     the previous event.
 *   - **The position.** A position that no title can reach is dropped: it
 *     says nothing about the viewing and only pollutes the numbers.
 *
 * The rule is pure, so it can be tested without a database.
 */

/**
 * How much the claim may exceed the elapsed time.
 *
 * The browser starts counting before the server records the previous event, so
 * the honest claim is always a little larger than the elapsed time. Thirty
 * seconds covers a slow request without opening a window for a fabricated
 * watch time.
 */
export const PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS = 30;

/** The largest watch time one event may report: one day. */
export const MAX_PLAYBACK_WATCH_SECONDS = 86_400;

/** The largest media position one event may report: one day. */
export const MAX_PLAYBACK_POSITION_SECONDS = 86_400;

/** What a playback event claims. */
export type PlaybackPlausibilityInput = Readonly<{
  /** The watch seconds the beacon claims. */
  watchDurationSeconds?: number | null | undefined;
  /** The media position the beacon claims. */
  positionSeconds?: number | null | undefined;
  /** When the previous stored event of this visitor and content was recorded. */
  previousEventAt?: Date | null | undefined;
  /** When this event is recorded. */
  now: Date;
}>;

/** What the server is willing to store. */
export type PlaybackPlausibility = Readonly<{
  /** The watch seconds, clamped to what the visitor could have watched. */
  watchDurationSeconds: number | null;
  /** The media position, or `null` when the claim is impossible. */
  positionSeconds: number | null;
}>;

/**
 * Clamp what a playback beacon claims to what the visitor could have done.
 *
 * @param input the claims
 * @returns the values the server stores
 */
export function clampPlaybackEvent(input: PlaybackPlausibilityInput): PlaybackPlausibility {
  return {
    watchDurationSeconds: clampWatchDuration(input),
    positionSeconds: clampPosition(input.positionSeconds),
  };
}

/**
 * The watch time a beacon may claim.
 *
 * The claim is bounded by the time that passed since the previous stored
 * event of the same visitor and the same content, plus a tolerance, and by an
 * absolute maximum.
 */
function clampWatchDuration(input: PlaybackPlausibilityInput): number | null {
  const claimed = input.watchDurationSeconds;

  if (typeof claimed !== 'number' || !Number.isFinite(claimed) || claimed < 0) {
    return null;
  }

  let cap = MAX_PLAYBACK_WATCH_SECONDS;

  if (input.previousEventAt instanceof Date) {
    const elapsedSeconds = (input.now.getTime() - input.previousEventAt.getTime()) / 1000;

    // A clock that moved backwards yields no elapsed time; the tolerance is
    // the only allowance in that case.
    const boundedElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;

    cap = Math.min(cap, boundedElapsed + PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS);
  }

  return Math.max(0, Math.min(Math.round(claimed), Math.floor(cap)));
}

/**
 * The media position a beacon may claim.
 *
 * A position beyond the absolute maximum describes no real title, so it is
 * dropped rather than stored.
 */
function clampPosition(positionSeconds: number | null | undefined): number | null {
  if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) {
    return null;
  }

  if (positionSeconds < 0 || positionSeconds > MAX_PLAYBACK_POSITION_SECONDS) {
    return null;
  }

  return Math.round(positionSeconds);
}
