'use client';

import type { ComponentRef, JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MediaPlayer, MediaProvider, Track } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';

import type { SubtitleTrackDto } from '@/lib/contracts/subtitle-track-form';

import { PlaybackFailureReport } from './playback-failure-report';
import { usePlaybackReset } from './playback-reset';

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
  episodeId?: string;
  /** The standalone movie being watched. Exactly one of episode/movie is set. */
  movieId?: string;
  /** The episode title, shown as the player's title. */
  title: string;
  /** The administrator-supplied, direct HTTPS MP4 URL. */
  source: string;
  /**
   * The version of the stored source.
   *
   * The player reports it with every episode position, so the server can ignore
   * a report that belongs to a source an administrator has replaced.
   */
  sourceVersion?: number;
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
  /**
   * The stored position the viewer may continue from.
   *
   * The player offers it instead of silently starting over: the viewer decides
   * whether to continue or to restart.
   */
  resumePositionSeconds?: number;
  /**
   * The canonical href of the next playable episode.
   *
   * When the current episode ends, the browser moves straight to it. The href
   * is computed on the server from the published content order, so an
   * unpublished or unavailable episode can never be entered this way.
   */
  nextHref?: string | null;
  /**
   * Whether playback should start as soon as the media can play.
   *
   * Used by the automatic next-episode flow. The browser may refuse to start
   * audio without a gesture; the player stays usable either way.
   */
  autoPlay?: boolean;
  /**
   * How the player moves to the next episode.
   *
   * The default is a full page load, which starts the next episode's player
   * from a clean state. The hook exists so the behaviour can be observed in a
   * test without navigating the test runner.
   */
  onNavigateToNext?: (_href: string) => void;
  /** What is being played; used in the failure message. */
  mediaLabel?: 'episode' | 'movie';
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

/** The imperative handle Vidstack exposes on the player element. */
type PlayerInstance = ComponentRef<typeof MediaPlayer>;

/** Format a position as `h:mm:ss` or `m:ss`. */
export function formatPlaybackTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const secondsWithinHour = total % 3600;
  const minutes = Math.floor(secondsWithinHour / 60);
  const remainder = secondsWithinHour % 60;

  const paddedSeconds = String(remainder).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}
export function VidstackPlayer({
  episodeId,
  movieId,
  title,
  source,
  sourceVersion,
  subtitleTracks,
  signedIn,
  completionThresholdPercent,
  resumePositionSeconds = 0,
  nextHref = null,
  autoPlay = false,
  onNavigateToNext,
  mediaLabel = 'episode',
}: Readonly<VidstackPlayerProps>): JSX.Element {
  // The retry counter remounts the player with the *same* stored URL. It is
  // only ever changed by the viewer's own click.
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  // The resume offer disappears once the viewer has chosen what to do.
  const [resumeOffer, setResumeOffer] = useState(resumePositionSeconds > 0);

  const playerRef = useRef<PlayerInstance | null>(null);
  const autoPlayAttemptedRef = useRef(false);

  // The manual "mark as unwatched" signal. The server has already moved the
  // stored position back to the beginning; the player has to move the media
  // there as well, or the next heartbeat would report the old position and
  // complete the episode again.
  const playbackReset = usePlaybackReset();
  const resetVersion = playbackReset?.resetVersion ?? 0;

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

  /** Continue from the stored position. */
  const handleResume = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.currentTime = resumePositionSeconds;
      positionRef.current = resumePositionSeconds;
    }

    setResumeOffer(false);
  }, [resumePositionSeconds]);

  /** Start the media again from the beginning. */
  const handleRestart = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.currentTime = 0;
    }

    positionRef.current = 0;
    setResumeOffer(false);
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

    const payload =
      episodeId !== undefined
        ? {
            episodeId,
            positionSeconds: Math.floor(position),
            durationSeconds: Math.floor(duration),
            watchedAt: new Date().toISOString(),
            sourceVersion,
          }
        : {
            movieId,
            positionSeconds: Math.floor(position),
            durationSeconds: Math.floor(duration),
            watchedAt: new Date().toISOString(),
          };

    // The heartbeat is a REST beacon with a keepalive fetch: the report has to
    // survive the page being closed, which a Server Action cannot promise.
    void fetch('/api/playback/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // A failed progress write must never interrupt playback.
    });
  }, [episodeId, movieId, signedIn, sourceVersion]);

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

  /**
   * Move straight to the next playable episode when the current one ends.
   *
   * The next episode's href was computed on the server from the published
   * content order, so an unpublished or unavailable episode can never be
   * entered this way. There is no countdown: the viewer asked for the next
   * episode, and the page changes immediately.
   */
  const handleEnded = useCallback(() => {
    flushProgress();

    if (!nextHref) {
      return;
    }

    const duration = durationRef.current;
    const completed =
      duration <= 0 || positionRef.current >= duration * completionThresholdPercent / 100;

    if (!completed) {
      return;
    }

    // The next page starts its own player and is told to begin playback
    // immediately, so the viewer does not have to press play again.
    const separator = nextHref.includes('?') ? '&' : '?';
    const target = `${nextHref}${separator}autoplay=1`;

    if (onNavigateToNext) {
      onNavigateToNext(target);
      return;
    }

    window.location.assign(target);
  }, [completionThresholdPercent, flushProgress, nextHref, onNavigateToNext]);

  /** Start playback when the automatic next-episode flow asks for it. */
  const handleCanPlay = useCallback(() => {
    if (!autoPlay || autoPlayAttemptedRef.current) {
      return;
    }

    autoPlayAttemptedRef.current = true;

    void playerRef.current?.play().catch(() => {
      // The browser refused to start playback without a gesture. The viewer
      // still has the player's own play control.
    });
  }, [autoPlay]);

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

  /**
   * Start over when the viewer marks the episode unwatched.
   *
   * The pending report is dropped rather than sent: it describes the position
   * from before the decision. The media element returns to the beginning, the
   * resume offer disappears, and the completion flag is cleared, so the next
   * heartbeat reports the new position.
   */
  useEffect(() => {
    if (resetVersion === 0) {
      return;
    }

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    positionRef.current = 0;
    reportedPositionRef.current = 0;
    thresholdReachedRef.current = false;
    setResumeOffer(false);

    if (playerRef.current) {
      playerRef.current.currentTime = 0;
    }
  }, [resetVersion]);

  return (
    <div className="space-y-3">
      {resumeOffer ? (
        <div
          role="group"
          aria-label="Resume playback"
          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-muted-foreground">
            You stopped watching at {formatPlaybackTime(resumePositionSeconds)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleResume}
              className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Resume from {formatPlaybackTime(resumePositionSeconds)}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              className="min-h-11 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
            >
              Start from the beginning
            </button>
          </div>
        </div>
      ) : null}

      <MediaPlayer
        key={attempt}
        ref={playerRef}
        title={title}
        src={source}
        crossOrigin={CROSS_ORIGIN}
        playsInline
        onError={handleError}
        onCanPlay={handleCanPlay}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onPause={flushProgress}
        onEnded={handleEnded}
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
          <p className="text-sm font-medium text-destructive">
            This {mediaLabel} could not be played.
          </p>
          <p className="text-xs text-muted-foreground">
            {failure} The source is served by an external host and may be unreachable, may block
            cross-origin requests, or may not support byte-range requests. The stored source has
            not been changed — only an administrator can replace it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRetry}
              className="min-h-11 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
            >
              Try again
            </button>
            {episodeId ? <PlaybackFailureReport episodeId={episodeId} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
