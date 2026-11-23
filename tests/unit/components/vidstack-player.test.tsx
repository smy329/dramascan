// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The viewer's player.
 *
 * The browser is the only component that contacts the external media host:
 * the application server never fetches, proxies, relays, or rehosts a video.
 * The player therefore has to hand the stored URL to the browser as-is, offer
 * the viewer's manual retry when the source fails, and never retry on its own.
 *
 * The player also reports the viewer's position for a signed-in viewer. The
 * report is a REST beacon with a keepalive `fetch` — it has to survive the
 * page being closed — and it is debounced: the browser must not write to
 * PostgreSQL on every time-update, and an anonymous viewer has no progress to
 * store.
 *
 * The Vidstack components are mocked here: this test covers the player's own
 * behaviour, and the end-to-end suite covers the real player in Chromium.
 */

const { reportPlaybackFailureActionMock } = vi.hoisted(() => ({
  reportPlaybackFailureActionMock: vi.fn(),
}));

vi.mock('@/workflows/playback/actions', () => ({
  reportPlaybackFailureAction: reportPlaybackFailureActionMock,
}));

vi.mock('@vidstack/react', () => ({
  MediaPlayer: ({
    src,
    title,
    crossOrigin,
    onError,
    onTimeUpdate,
    onDurationChange,
    onPause,
    onEnded,
    children,
  }: {
    src?: string;
    title?: string;
    crossOrigin?: string;
    onError?: (_detail: { message: string; code?: number }) => void;
    onTimeUpdate?: (_detail: { currentTime: number }) => void;
    onDurationChange?: (_duration: number) => void;
    onPause?: () => void;
    onEnded?: () => void;
    children?: React.ReactNode;
  }) => (
    <div
      data-testid="media-player"
      data-src={src}
      data-title={title}
      data-crossorigin={crossOrigin}
    >
      <button
        type="button"
        data-testid="simulate-error"
        onClick={() => onError?.({ message: 'The media could not be loaded.', code: 3 })}
      >
        simulate error
      </button>
      <button
        type="button"
        data-testid="simulate-duration"
        onClick={() => onDurationChange?.(1000)}
      >
        simulate duration
      </button>
      <button
        type="button"
        data-testid="simulate-time-update"
        onClick={() => onTimeUpdate?.({ currentTime: 120 })}
      >
        simulate time update
      </button>
      <button type="button" data-testid="simulate-pause" onClick={() => onPause?.()}>
        simulate pause
      </button>
      <button type="button" data-testid="simulate-ended" onClick={() => onEnded?.()}>
        simulate ended
      </button>
      <button
        type="button"
        data-testid="simulate-complete"
        onClick={() => {
          onTimeUpdate?.({ currentTime: 1000 });
          onEnded?.();
        }}
      >
        simulate complete
      </button>
      {children}
    </div>
  ),
  MediaProvider: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="media-provider">{children}</div>
  ),
  Track: (props: Record<string, unknown>) => (
    <track
      data-testid="subtitle-track"
      data-src={String(props.src ?? '')}
      data-label={String(props.label ?? '')}
      data-lang={String(props.lang ?? '')}
      data-type={String(props.type ?? '')}
      data-default={String(props.default ?? false)}
    />
  ),
}));

vi.mock('@vidstack/react/player/layouts/default', () => ({
  DefaultVideoLayout: () => <div data-testid="default-layout" />,
  defaultLayoutIcons: {},
}));

import { VidstackPlayer, type PlayerSubtitleTrack } from '@/components/player/vidstack-player';
import {
  PlaybackResetProvider,
  usePlaybackReset,
} from '@/components/player/playback-reset';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

const SOURCE = 'https://media.example.com/episodes/1.mp4';
const EPISODE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const MOVIE_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

const SUBTITLES: PlayerSubtitleTrack[] = [
  {
    id: 'track-en',
    language: 'en',
    label: 'English',
    sourceUrl: 'https://media.example.com/subs/1.en.vtt',
    format: 'vtt',
    isDefault: true,
  },
  {
    id: 'track-ko',
    language: 'ko',
    label: 'Korean',
    sourceUrl: 'https://media.example.com/subs/1.ko.vtt',
    format: 'vtt',
    isDefault: false,
  },
];

/** Render the player with the props a watch page passes. */
function renderPlayer(
  overrides: Partial<{
    signedIn: boolean;
    completionThresholdPercent: number;
    subtitleTracks: PlayerSubtitleTrack[];
    resumePositionSeconds: number;
    nextHref: string | null;
    onNavigateToNext: (_href: string) => void;
    movieId: string;
  }> = {},
  wrap?: (_player: React.ReactElement) => React.ReactElement
): void {
  const player = (
    <VidstackPlayer
      episodeId={overrides.movieId ? undefined : EPISODE_ID}
      movieId={overrides.movieId}
      title="Episode 1"
      source={SOURCE}
      sourceVersion={1}
      subtitleTracks={overrides.subtitleTracks ?? []}
      signedIn={overrides.signedIn ?? true}
      completionThresholdPercent={overrides.completionThresholdPercent ?? 90}
      resumePositionSeconds={overrides.resumePositionSeconds ?? 0}
      nextHref={overrides.nextHref ?? null}
      onNavigateToNext={overrides.onNavigateToNext}
    />
  );

  render(wrap ? wrap(player) : player);
}

/**
 * The control the watched toggle uses.
 *
 * The toggle itself is a Server Action, so this test drives the shared reset
 * signal directly: the player has to react to the same signal the toggle
 * raises.
 */
function ResetControl(): React.ReactElement {
  const playbackReset = usePlaybackReset();

  return (
    <button
      type="button"
      data-testid="request-reset"
      onClick={() => playbackReset?.requestReset()}
    >
      request reset
    </button>
  );
}

beforeEach(() => {
  reportPlaybackFailureActionMock.mockReset();
  reportPlaybackFailureActionMock.mockResolvedValue({ ok: true, data: { id: 'report-1' } });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  cleanup();
});

describe('VidstackPlayer', () => {
  it('hands the stored source to the browser unchanged', () => {
    renderPlayer();

    expect(screen.getByTestId('media-player').getAttribute('data-src')).toBe(SOURCE);
  });

  it('requests the media cross-origin so external subtitles can load', () => {
    renderPlayer();

    // Vidstack applies the player's cross-origin setting to the media element
    // and to the text-track fetches. A text track on a foreign origin is only
    // loadable when the media element is cross-origin.
    expect(screen.getByTestId('media-player').getAttribute('data-crossorigin')).toBe('anonymous');
  });

  it('passes every subtitle track with its label, language, and default selection', () => {
    renderPlayer({ subtitleTracks: SUBTITLES });

    const tracks = screen.getAllByTestId('subtitle-track');

    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.getAttribute('data-src')).toBe(SUBTITLES[0]?.sourceUrl);
    expect(tracks[0]?.getAttribute('data-label')).toBe('English');
    expect(tracks[0]?.getAttribute('data-lang')).toBe('en');
    expect(tracks[0]?.getAttribute('data-default')).toBe('true');
    expect(tracks[1]?.getAttribute('data-default')).toBe('false');
  });

  it('shows a manual retry control after the source fails', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-error'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    });
  });

  it('does not retry on its own', async () => {
    renderPlayer();

    const player = screen.getByTestId('media-player');
    const before = player.getAttribute('data-src');

    fireEvent.click(screen.getByTestId('simulate-error'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    // No automatic retry: the player is not re-created behind the viewer's
    // back, and the stored source is untouched.
    expect(screen.getAllByTestId('media-player')).toHaveLength(1);
    expect(screen.getByTestId('media-player').getAttribute('data-src')).toBe(before);
  });

  it('retries the same source when the viewer asks for it', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-error'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    });

    expect(screen.getByTestId('media-player').getAttribute('data-src')).toBe(SOURCE);
  });

  it('explains that the stored source is unchanged and needs an administrator', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-error'));

    await waitFor(() => {
      expect(screen.getByText(/administrator/i)).toBeTruthy();
    });
  });

  it('lets the viewer report the failure to an administrator', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-error'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /report/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /report/i }));

    await waitFor(() => {
      expect(reportPlaybackFailureActionMock).toHaveBeenCalledTimes(1);
    });

    expect(reportPlaybackFailureActionMock).toHaveBeenCalledWith({
      episodeId: EPISODE_ID,
      reason: 'unknown',
    });
  });
});

describe('VidstackPlayer progress reporting', () => {
  it('reports the observed position to the heartbeat endpoint when the viewer pauses', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-pause'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    // The heartbeat is a REST beacon, not a Server Action: it has to survive
    // the page being closed.
    expect(url).toBe('/api/playback/progress');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);

    const payload = JSON.parse(String(init.body)) as {
      episodeId: string;
      positionSeconds: number;
      durationSeconds: number;
      watchedAt: string;
      sourceVersion: number;
    };

    expect(payload.episodeId).toBe(EPISODE_ID);
    expect(payload.positionSeconds).toBe(120);
    expect(payload.durationSeconds).toBe(1000);
    expect(Number.isNaN(Date.parse(payload.watchedAt))).toBe(false);
    // The report names the source version it belongs to, so the server can
    // ignore it when an administrator replaces the source.
    expect(payload.sourceVersion).toBe(1);
  });

  it('does not write on every time update', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));

    // The write is debounced: the position is reported on the next pause, not
    // on every time update.
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('simulate-pause'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('reports the position when the episode ends', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-ended'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('reports nothing for an anonymous viewer', async () => {
    renderPlayer({ signedIn: false });

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-pause'));

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a movie position instead of an episode position', async () => {
    renderPlayer({ movieId: MOVIE_ID });

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-pause'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as {
      episodeId?: string;
      movieId?: string;
      positionSeconds: number;
      durationSeconds: number;
    };

    expect(payload.movieId).toBe(MOVIE_ID);
    expect(payload.episodeId).toBeUndefined();
    expect(payload.positionSeconds).toBe(120);
    expect(payload.durationSeconds).toBe(1000);
  });
});

describe('VidstackPlayer continue playback', () => {
  it('offers to continue from the stored position', () => {
    renderPlayer({ resumePositionSeconds: 120 });

    expect(screen.getByRole('button', { name: /resume from 2:00/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /start from the beginning/i })).toBeTruthy();
  });

  it('offers nothing when there is no stored position', () => {
    renderPlayer();

    expect(screen.queryByRole('button', { name: /resume from/i })).toBeNull();
  });

  it('drops the offer once the viewer has chosen', () => {
    renderPlayer({ resumePositionSeconds: 120 });

    fireEvent.click(screen.getByRole('button', { name: /resume from 2:00/i }));

    expect(screen.queryByRole('button', { name: /resume from/i })).toBeNull();
  });

  it('also drops the offer when the viewer restarts', () => {
    renderPlayer({ resumePositionSeconds: 120 });

    fireEvent.click(screen.getByRole('button', { name: /start from the beginning/i }));

    expect(screen.queryByRole('button', { name: /resume from/i })).toBeNull();
  });
});

describe('VidstackPlayer manual unwatched reset', () => {
  it('drops the pending report and the resume offer when the viewer marks the episode unwatched', async () => {
    renderPlayer({ resumePositionSeconds: 120 }, player => (
      <PlaybackResetProvider>
        <ResetControl />
        {player}
      </PlaybackResetProvider>
    ));

    // The viewer watches a little, and the position is reported.
    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-pause'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // The viewer marks the episode unwatched.
    fireEvent.click(screen.getByTestId('request-reset'));

    // The resume offer disappears: the stored position is back at the
    // beginning.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /resume from/i })).toBeNull();
    });

    // The next heartbeat is sent again. Without the reset the player would
    // still consider the old position reported and would stay silent, and the
    // viewer's decision would be undone by the next report.
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-pause'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as { positionSeconds: number };

    expect(payload.positionSeconds).toBe(120);
  });
});

describe('VidstackPlayer automatic next episode', () => {
  const NEXT_HREF = '/drama/drama-id/the-drama/episode/next-episode-id';

  it('moves to the next episode as soon as the current one ends', () => {
    const navigate = vi.fn();
    renderPlayer({ nextHref: NEXT_HREF, onNavigateToNext: navigate });

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-complete'));

    expect(navigate).toHaveBeenCalledTimes(1);
    // The next page is told to start playing immediately: there is no countdown.
    expect(navigate).toHaveBeenCalledWith(`${NEXT_HREF}?autoplay=1`);
  });

  it('stays on the episode when there is no next episode', () => {
    const navigate = vi.fn();
    renderPlayer({ onNavigateToNext: navigate });

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-ended'));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not move on when the completion threshold was not reached', () => {
    const navigate = vi.fn();
    renderPlayer({
      nextHref: NEXT_HREF,
      onNavigateToNext: navigate,
      completionThresholdPercent: 99,
    });

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-ended'));

    expect(navigate).not.toHaveBeenCalled();
  });
});
