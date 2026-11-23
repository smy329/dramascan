'use client';

import type { JSX } from 'react';
import { useFormContext } from 'react-hook-form';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser playback preview for the administrator-supplied direct MP4 URL.
 *
 * This component actively tests whether the source actually plays in the
 * browser. It does NOT treat a successful save, or an `.mp4` suffix, as proof
 * of playback — only what the browser actually does determines validity. The
 * server never fetches the URL.
 *
 * What counts as evidence:
 *
 *   - `playing` — the browser is decoding and playing the media. This is the
 *     evidence that matters. `canplay` is *not*: it only says the browser
 *     believes it could start.
 *   - A seek to 75 % of the duration, when the duration is known. A source
 *     that plays but cannot seek is missing byte-range support, and a viewer
 *     would not be able to use it properly.
 *
 * The preview requests the media with `crossorigin="anonymous"`, exactly like
 * the viewer's player does. A host that does not send CORS headers therefore
 * fails the preview — which is the point: the administrator must find out
 * before the source is stored, not after the first viewer presses play.
 *
 * Failure modes reported:
 *   - Network error / inaccessible URL
 *   - Unsupported media type
 *   - CORS restriction
 *   - Lack of byte-range seek support
 *   - Other playback failure
 */

/** The verification state of the preview. */
export type VideoSourcePreviewStatus = 'idle' | 'loading' | 'verified' | 'failed';

/** The verification state, as reported to the parent. */
export type VideoSourcePreviewState = {
  status: VideoSourcePreviewStatus;
  error: string | null;
};

/** How long the seek check waits for the position to land. */
const SEEK_TIMEOUT_MS = 3000;

/** The fraction of the duration the seek check targets. */
const SEEK_FRACTION = 0.75;

/**
 * Turn a media error into an explanation the administrator can act on.
 *
 * The browser's error codes distinguish a transport problem from a decoding
 * problem, and those two need different fixes: one is about the URL and the
 * host's cross-origin policy, the other is about the file itself.
 */
function describeMediaError(error: MediaError | null): string {
  if (!error) {
    return 'The browser could not play this source.';
  }

  switch (error.code) {
    case 1:
      return 'The media download was aborted before it could play.';
    case 2:
      return "The browser could not decode this source. The host may serve an unsupported format, or the request may be blocked by the host's cross-origin (CORS) policy.";
    case 3:
      return 'The browser could not load the file from the host. Check that the URL is reachable and that the host allows cross-origin (CORS) requests.';
    case 4:
      return 'The browser could not decode the media. The host may serve an unsupported or corrupt file.';
    default:
      return error.message || 'The browser could not play this source.';
  }
}

/**
 * Administrator playback preview, bound to a form field.
 *
 * The source is read from the React Hook Form field the parent registered, so
 * the preview follows whatever the administrator types.
 *
 * The preview also writes the administrator's confirmation into the form: the
 * server stores a source only when the payload says that the browser verified
 * it, and the browser is the only component that can make that check. The
 * confirmation follows the preview state exactly — it is set when the browser
 * played the source and withdrawn as soon as it stops being true.
 *
 * @param name             Form field holding the source URL.
 * @param confirmationField Form field that carries the preview confirmation;
 *                          `null` disables the confirmation entirely.
 * @param onStateChange    Called whenever the verification state changes, so the
 *                         parent can require a verified preview before it lets
 *                         the administrator confirm a replacement.
 */
export function VideoSourcePreview({
  name = 'video_source',
  confirmationField = 'video_source_preview_confirmed',
  onStateChange,
}: Readonly<{
  name?: string;
  confirmationField?: string | null;
  onStateChange?: (_state: VideoSourcePreviewState) => void;
}>): JSX.Element {
  const { watch, setValue, register } = useFormContext<Record<string, unknown>>();
  const watched = watch(name);
  const source = typeof watched === 'string' ? watched.trim() : '';

  const handleStateChange = useCallback(
    (state: VideoSourcePreviewState) => {
      if (confirmationField) {
        setValue(confirmationField, state.status === 'verified');
      }

      onStateChange?.(state);
    },
    [confirmationField, onStateChange, setValue]
  );

  return (
    <>
      {confirmationField ? <input type="hidden" {...register(confirmationField)} /> : null}
      <VideoSourcePlaybackPreview source={source} onStateChange={handleStateChange} />
    </>
  );
}

/**
 * Administrator playback preview of an explicit URL.
 *
 * The replacement flow keeps the new URL in its own state instead of a form
 * field, because the episode form and the replacement are two different
 * operations: saving the episode must never be able to change the source.
 *
 * @param source        The URL to test in the browser.
 * @param onStateChange Called whenever the verification state changes.
 */
export function VideoSourcePlaybackPreview({
  source,
  onStateChange,
}: Readonly<{
  source: string;
  onStateChange?: (_state: VideoSourcePreviewState) => void;
}>): JSX.Element {
  const [state, setState] = useState<VideoSourcePreviewState>({
    status: 'idle',
    error: null,
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onStateChange);

  callbackRef.current = onStateChange;

  const report = useCallback((next: VideoSourcePreviewState) => {
    setState(next);
    callbackRef.current?.(next);
  }, []);

  useEffect(() => {
    const element = videoRef.current;

    if (!source) {
      report({ status: 'idle', error: null });
      return () => undefined;
    }

    report({ status: 'loading', error: null });

    if (!element) {
      return () => undefined;
    }

    let disposed = false;
    let seekTimer: ReturnType<typeof setTimeout> | null = null;
    let playbackConfirmed = false;

    /**
     * Verify that the source can be seeked.
     *
     * The position has to actually land on the target: a source that ignores
     * the seek (because the host does not serve byte ranges) is not usable
     * for a viewer, so the check fails instead of quietly passing.
     */
    const verifySeek = (media: HTMLVideoElement, duration: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const target = duration * SEEK_FRACTION;
        let settled = false;

        const finish = (failure: Error | null) => {
          if (settled) {
            return;
          }

          settled = true;

          if (seekTimer !== null) {
            clearTimeout(seekTimer);
            seekTimer = null;
          }

          media.removeEventListener('seeked', onSeeked);

          if (failure) {
            reject(failure);
          } else {
            resolve();
          }
        };

        const onSeeked = () => {
          const position = media.currentTime;

          if (
            Number.isFinite(position) &&
            Math.abs(position - target) <= Math.max(target * 0.05, 0.5)
          ) {
            finish(null);
          }
        };

        seekTimer = setTimeout(() => {
          finish(
            new Error(
              'The source did not seek to the requested position. The host most likely does not support byte-range requests, which the player needs for seeking.'
            )
          );
        }, SEEK_TIMEOUT_MS);

        media.addEventListener('seeked', onSeeked);

        try {
          media.currentTime = target;
        } catch {
          finish(new Error('The browser refused to seek in this source.'));
        }
      });

    const onPlaying = () => {
      if (playbackConfirmed) {
        return;
      }

      playbackConfirmed = true;

      // The playback attempt starts muted because browsers block unmuted
      // automatic playback. Once the media is playing, the sound is restored
      // so the administrator can hear it.
      element.muted = false;

      const duration = element.duration;

      if (!Number.isFinite(duration) || duration <= 0) {
        // The duration is unknown, so seeking cannot be checked. Playback
        // itself is the evidence.
        report({ status: 'verified', error: null });
        return;
      }

      void verifySeek(element, duration).then(
        () => {
          if (!disposed) {
            report({ status: 'verified', error: null });
          }
        },
        (failure: Error) => {
          if (!disposed) {
            report({ status: 'failed', error: failure.message });
          }
        }
      );
    };

    const onError = () => {
      report({ status: 'failed', error: describeMediaError(element.error) });
    };

    const onWaiting = () => {
      if (!playbackConfirmed) {
        report({ status: 'loading', error: null });
      }
    };

    const startPlayback = () => {
      if (disposed || playbackConfirmed) {
        return;
      }

      try {
        // Muted first: an unmuted automatic start is blocked by every modern
        // browser's autoplay policy.
        element.muted = true;

        const started = element.play();

        if (started && typeof started.then === 'function') {
          started.catch(() => {
            if (!disposed && !playbackConfirmed) {
              report({
                status: 'failed',
                error:
                  'The browser refused to start playback automatically. Press play on the preview to test the source manually.',
              });
            }
          });
        }
      } catch {
        report({
          status: 'failed',
          error: 'The browser could not start playback for this source.',
        });
      }
    };

    element.addEventListener('playing', onPlaying);
    element.addEventListener('error', onError);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('loadedmetadata', startPlayback);
    element.addEventListener('canplay', startPlayback);

    try {
      element.load();
    } catch {
      report({
        status: 'failed',
        error: 'The browser could not load this source.',
      });
    }

    return () => {
      disposed = true;

      if (seekTimer !== null) {
        clearTimeout(seekTimer);
        seekTimer = null;
      }

      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('error', onError);
      element.removeEventListener('waiting', onWaiting);
      element.removeEventListener('loadedmetadata', startPlayback);
      element.removeEventListener('canplay', startPlayback);
    };
  }, [source, report]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Playback preview</p>

      {source ? (
        <video
          ref={videoRef}
          key={source}
          controls
          preload="metadata"
          src={source}
          // The preview has to test the source under the same conditions the
          // viewer's player will use. The player requests the media with
          // `crossorigin="anonymous"`, which makes the browser require a
          // CORS-enabled response from the host. Without this attribute the
          // preview would happily play a host that the player rejects, and
          // the administrator would approve a source no viewer can watch.
          crossOrigin="anonymous"
          className="max-h-72 w-full rounded-lg border border-border bg-black"
        >
          Your browser cannot play this source.
        </video>
      ) : null}

      {state.status === 'loading' && (
        <p className="text-xs text-muted-foreground">
          Loading the source and testing playback in this browser...
        </p>
      )}

      {state.status === 'verified' && (
        <p className="text-xs text-success">
          ✓ Playback verified — the browser played this source from the external host.
        </p>
      )}

      {state.status === 'failed' && state.error && (
        <p className="text-xs text-destructive">✗ Playback failed: {state.error}</p>
      )}

      {state.status === 'idle' && (
        <p className="text-xs text-muted-foreground">
          Enter a direct HTTPS MP4 URL to see a playback preview.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        A successful save or an .mp4 suffix is not proof of playback. The browser requests the
        file directly from the external host, which must allow cross-origin (CORS) and byte-range
        requests for playback and seeking to work.
      </p>
    </div>
  );
}
