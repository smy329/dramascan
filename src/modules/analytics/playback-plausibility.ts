/**
 * The playback plausibility rule (D-070, D-090).
 *
 * A playback beacon is public: anybody can post to the playback endpoint. The
 * server therefore decides what a beacon may claim, not the browser.
 *
 * The browser reports the **cumulative** watch time of its viewing session,
 * not the time since the last event. The server keeps the cumulative watch
 * time it has already accounted for, and two things follow from that:
 *
 *   - **The first beacon of a session cannot forge a watch time.** The server
 *     stamps the start of the session, and the first claim is measured against
 *     that instant. Before the cumulative protocol, the first beacon had no
 *     previous event to measure against and could claim a whole day.
 *   - **A lost acknowledgement cannot double-count a delta.** A beacon that
 *     repeats a cumulative claim is a delta of zero, because the server has
 *     already accounted for that watch time.
 *
 * Two claims are bounded here:
 *
 *   - **The watch time.** The delta since the accounted cumulative claim, plus
 *     a small tolerance, and never more than the time that really passed.
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

/**
 * The server-verified watch time a completion must be backed by.
 *
 * The media duration is not known to the server: no content row carries one,
 * and the duration the browser reports belongs to the user-facing playback
 * progress, which the requirements keep separate from the analytics. The
 * server can therefore only support a **lower bound** — a completion counts
 * when the viewer really watched something substantial (D-073).
 *
 * One minute is the smallest duration that separates a viewing from a beacon
 * that was posted and forgotten.
 */
export const COMPLETION_MINIMUM_WATCH_SECONDS = 60;

/** What the viewer's own watch history says about a completion claim. */
export type CompletionSupport = Readonly<{
  /** Whether the server stored a playback start for this visitor and content. */
  hasPlaybackStart: boolean;
  /** The cumulative watch duration the server accepted for this visitor. */
  cumulativeWatchSeconds: number;
}>;

/**
 * Does the viewer's own watch history support a completion claim?
 *
 * Two facts decide it, and both are server-derived:
 *
 *   - **The viewing began.** The server stored a `play` event for this visitor
 *     and this content, so there is a viewing to complete.
 *   - **The viewer watched.** The cumulative watch duration the server
 *     accepted — the sum of every delta it stored, bounded by the time that
 *     really passed — reaches the minimum.
 *
 * A forged beacon that claims a completion without a viewing, or without any
 * watch time behind it, is refused: the event is still recorded, but it is not
 * counted as a completion.
 *
 * @param input what the watch history says
 * @returns whether the completion may be counted
 */
export function isCompletionSupported(input: CompletionSupport): boolean {
  if (!input.hasPlaybackStart) {
    return false;
  }

  return input.cumulativeWatchSeconds >= COMPLETION_MINIMUM_WATCH_SECONDS;
}

/** What the browser claims about the watch time of its viewing session. */
export type PlaybackWatchClaim = Readonly<{
  /** The cumulative watch seconds the browser claims for the session. */
  cumulativeWatchSeconds?: number | null | undefined;
  /** The cumulative watch seconds the server has already accounted for. */
  accountedCumulativeSeconds?: number | null | undefined;
  /** When the server stored the last event of the viewing session. */
  lastEventAt?: Date | null | undefined;
  /** When the server created the viewing session. */
  startedAt?: Date | null | undefined;
  /** When this event is recorded. */
  now: Date;
}>;

/** What the server is willing to store. */
export type PlaybackWatchResolution = Readonly<{
  /** The watch seconds the server stores. */
  watchDurationSeconds: number;
  /** The cumulative watch seconds the server accounts for after the event. */
  accountedCumulativeSeconds: number;
  /** Whether the claim restarted the counter of the viewing session. */
  restarted: boolean;
}>;

/**
 * Resolve the watch time a beacon may claim.
 *
 * The claim is a cumulative total, so the watch time of the event is the part
 * of it that the server has not accounted for yet. The delta is bounded by the
 * time that really passed since the last stored event of the session, plus
 * the tolerance, and by an absolute maximum.
 *
 * @param input the claim and the server's own baseline
 * @returns the watch time the server stores and the new baseline
 */
export function resolvePlaybackWatchSeconds(input: PlaybackWatchClaim): PlaybackWatchResolution {
  const accounted = normalizeSeconds(input.accountedCumulativeSeconds) ?? 0;
  const claimed = normalizeSeconds(input.cumulativeWatchSeconds);

  // A claim that is not a number carries no watch time, and it must not
  // disturb the baseline: a malformed beacon cannot restart the session.
  if (claimed === null) {
    return {
      watchDurationSeconds: 0,
      accountedCumulativeSeconds: accounted,
      restarted: false,
    };
  }

  // A claim below what the server accounted for means the browser restarted
  // its counter: a new viewing inside the same session key. The elapsed time
  // is measured from the restart, so the new viewing cannot claim the watch
  // time of the old one.
  const restarted = claimed < accounted;
  const baseline = restarted ? 0 : accounted;
  const anchor = restarted
    ? input.now
    : input.lastEventAt ?? input.startedAt ?? input.now;

  const delta = Math.max(0, claimed - baseline);
  const elapsedSeconds = Math.max(0, (input.now.getTime() - anchor.getTime()) / 1000);
  const cap = Math.min(
    MAX_PLAYBACK_WATCH_SECONDS,
    Math.floor(elapsedSeconds + PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS)
  );

  return {
    watchDurationSeconds: Math.min(delta, cap),
    accountedCumulativeSeconds: Math.max(baseline, claimed),
    restarted,
  };
}

/**
 * The media position a beacon may claim.
 *
 * A position beyond the absolute maximum describes no real title, so it is
 * dropped rather than stored.
 *
 * @param positionSeconds the claimed position
 * @returns the position the server stores, or `null` when it is impossible
 */
export function clampPlaybackPosition(positionSeconds: number | null | undefined): number | null {
  if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) {
    return null;
  }

  if (positionSeconds < 0 || positionSeconds > MAX_PLAYBACK_POSITION_SECONDS) {
    return null;
  }

  return Math.round(positionSeconds);
}

/**
 * A whole number of seconds, or `null` when the claim is not one.
 *
 * @param value the claimed seconds
 * @returns the seconds, or `null`
 */
function normalizeSeconds(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.floor(value);
}
