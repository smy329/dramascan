'use client';

import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MediaPlayer, MediaProvider, Track } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';

import type { SubtitleTrackDto } from '@/lib/contracts/subtitle-track-form';
import { savePlaybackProgressAction } from '@/workflows/playback/actions';

import { PlaybackFailureReport } from './playback-failure-report';

/**
 * The viewer's player.
 *
 * The browser is the only component that ever contacts the external media
 * host. The application server never fetches, proxies, relays, or rehosts a
 * video or a subtitle file: the stored URL is handed to the browser as-is, and
 * the browser requests it directly from the host that serves it.
 *
 * When the source fails, the viewer gets a clear message and a manual retry.
 * There is no automatic retry, no automatic search for another source, no
 * provider switching, and no background repair: the stored source stays
 * exactly as it is until an administrator replaces it, because a viewer-side
 * "fix" would silently serve something the administrator never approved.
 *
 * The player also reports the viewer's position for a signed-in viewer. The
 * report is debounced — the browser must not write to PostgreSQL on every
 * time update — and it carries the moment the position was observed, so an
 * update that was observed earlier cannot overwrite a newer one.
 */

/** The subtitle data the player consumes. */
export type PlayerSubtitleTrack = Pick<
  SubtitleTrackDto,
  'id' | 'language' | 'label' | 'sourceUrl' | 'format' | 'isDefault'
>;

export type VidstackPlayerProps = {
  /** The episode being watched; used when reporting a failure. */
  episodeId: string;
  /** The episode title, shown as the player's title. */
  title: string;
  /** The administrator-supplied, direct HTTPS MP4 URL. */
  source: string;
  /** The subtitle tracks the administrator attached to the episode. */
  subtitleTracks: PlayerSubtitleTrack[];
  /** Whether the viewer is signed in; only a signed-in viewer has progress. */
  signedIn: boolean;
  /**
   * The percentage of the episode that counts as watched.
   *
   * The value comes from the server configuration, so the player and the
   * server never apply divergent completion rules.
   */
  completionThresholdPercent: number;
};

/**
 * The media element's cross-origin setting.
 *
 * Subtitle files live on the same external host as the video, and a text
 * track can only be loaded when the media element itself is cross-origin.
 * Vidstack applies the player's `crossOrigin` setting to the media element
 * and to the text-track fetches, so the setting belongs on the player rather
 * than on the provider's raw media attributes.
 */
const CROSS_ORIGIN = 'anonymous';

/**
 * How often the position is written while the episode plays.
 *
 * A write every fifteen seconds is frequent enough to keep the resume point
 * close to the real position and rare enough not to turn playback into a
 * stream of database writes.
 */
const PROGRESS_SAVE_INTERVAL_MS = 15_000;

export function VidstackPlayer({
  episodeId,
  title,
  source,
  subtitleTracks,
  signedIn,
  completionThresholdPercent,
}: Readonly<VidstackPlayerProps>): JSX.Element {
  // The retry counter remounts the player with the *same* stored URL. It is
  // only ever changed by the viewer's own click.
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  // The position changes several times per second. It lives in refs so the
  // player does not re-render on every time update.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const reportedPositionRef = useRef(0);
  const thresholdReachedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleError = useCallback((detail: { message?: string; code?: number }) => {
    setFailure(detail?.message || 'The browser could not play this source.');
  }, []);

  const handleRetry = useCallback(() => {
    setFailure(null);
    setAttempt(current => current + 1);
  }, []);

  /**
   * Report the position that was observed.
   *
   * The report carries the moment the position was observed, so the server
   * can tell an older observation from a newer one even when the requests
   * arrive out of order.
   */
  const reportProgress = useCallback(() => {
    if (!signedIn) {
      return;
    }

    const position = positionRef.current;
    const duration = durationRef.current;

    // Nothing to store yet: the media has no known duration, or the viewer
    // has not moved the position since the last report.
    if (duration <= 0 || position === reportedPositionRef.current) {
      return;
    }

    reportedPositionRef.current = position;

    void savePlaybackProgressAction({
      episodeId,
      positionSeconds: Math.floor(position),
      durationSeconds: Math.floor(duration),
      watchedAt: new Date().toISOString(),
    }).catch(() => {
      // A failed progress write must never interrupt playback.
    });
  }, [episodeId, signedIn]);

  /** Schedule the next periodic report; the interval is not extended. */
  const scheduleProgressReport = useCallback(() => {
    if (!signedIn || timerRef.current !== null) {
      return;
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      reportProgress();
    }, PROGRESS_SAVE_INTERVAL_MS);
  }, [reportProgress, signedIn]);

  /** Report now and cancel the pending periodic report. */
  const flushProgress = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    reportProgress();
  }, [reportProgress]);

  const handleTimeUpdate = useCallback(
    (detail: { currentTime: number }) => {
      positionRef.current = detail.currentTime;

      const duration = durationRef.current;
      const reached =
        duration > 0 && detail.currentTime >= duration * completionThresholdPercent / 100;
      if (reached && !thresholdReachedRef.current) {
        thresholdReachedRef.current = true;
        // The episode counts as watched now, so the server is told right away
        // instead of at the next interval.
        flushProgress();
        return;
      }

      scheduleProgressReport();
    },
    [completionThresholdPercent, flushProgress, scheduleProgressReport]
  );

  const handleDurationChange = useCallback((duration: number) => {
    durationRef.current = duration;
  }, []);

  // The last report when the viewer leaves the page.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      reportProgress();
    },
    [reportProgress]
  );

  return (
    <div className="space-y-3">
      <MediaPlayer
        key={attempt}
        title={title}
        src={source}
        crossOrigin={CROSS_ORIGIN}
        onError={handleError}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onPause={flushProgress}
        onEnded={flushProgress}
        className="w-full overflow-hidden rounded-lg border border-border bg-black"
        style={{ aspectRatio: '16 / 9' }}
      >
        <MediaProvider>
          {subtitleTracks.map(track => (
            <Track
              key={track.id}
              src={track.sourceUrl}
              kind="subtitles"
              label={track.label}
              lang={track.language}
              type={track.format}
              default={track.isDefault}
            />
          ))}
        </MediaProvider>

        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>

      {failure ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="text-sm font-medium text-destructive">This episode could not be played.</p>
          <p className="text-xs text-muted-foreground">
            {failure} The source is served by an external host and may be unreachable, may block
            cross-origin requests, or may not support byte-range requests. The stored source has
            not been changed — only an administrator can replace it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium"
            >
              Try again
            </button>
            <PlaybackFailureReport episodeId={episodeId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
