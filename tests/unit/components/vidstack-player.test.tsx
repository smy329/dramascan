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
 * report is debounced: the browser must not write to PostgreSQL on every
 * time-update, and an anonymous viewer has no progress to store.
 *
 * The Vidstack components are mocked here: this test covers the player's own
 * behaviour, and the end-to-end suite covers the real player in Chromium.
 */

const { reportPlaybackFailureActionMock, savePlaybackProgressActionMock } = vi.hoisted(() => ({
  reportPlaybackFailureActionMock: vi.fn(),
  savePlaybackProgressActionMock: vi.fn(),
}));

vi.mock('@/workflows/playback/actions', () => ({
  reportPlaybackFailureAction: reportPlaybackFailureActionMock,
  savePlaybackProgressAction: savePlaybackProgressActionMock,
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

const SOURCE = 'https://media.example.com/episodes/1.mp4';
const EPISODE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

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
  }> = {}
): void {
  render(
    <VidstackPlayer
      episodeId={EPISODE_ID}
      title="Episode 1"
      source={SOURCE}
      subtitleTracks={overrides.subtitleTracks ?? []}
      signedIn={overrides.signedIn ?? true}
      completionThresholdPercent={overrides.completionThresholdPercent ?? 90}
    />
  );
}

beforeEach(() => {
  reportPlaybackFailureActionMock.mockReset();
  reportPlaybackFailureActionMock.mockResolvedValue({ ok: true, data: { id: 'report-1' } });
  savePlaybackProgressActionMock.mockReset();
  savePlaybackProgressActionMock.mockResolvedValue({ ok: true, data: { applied: true } });
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
  it('reports the observed position when the viewer pauses', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-pause'));

    await waitFor(() => {
      expect(savePlaybackProgressActionMock).toHaveBeenCalledTimes(1);
    });

    const payload = savePlaybackProgressActionMock.mock.calls[0]?.[0] as {
      episodeId: string;
      positionSeconds: number;
      durationSeconds: number;
      watchedAt: string;
    };

    expect(payload.episodeId).toBe(EPISODE_ID);
    expect(payload.positionSeconds).toBe(120);
    expect(payload.durationSeconds).toBe(1000);
    expect(Number.isNaN(Date.parse(payload.watchedAt))).toBe(false);
  });

  it('does not write on every time update', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));

    // The write is debounced: the position is reported on the next pause, not
    // on every time update.
    expect(savePlaybackProgressActionMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('simulate-pause'));

    await waitFor(() => {
      expect(savePlaybackProgressActionMock).toHaveBeenCalledTimes(1);
    });
  });

  it('reports the position when the episode ends', async () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-ended'));

    await waitFor(() => {
      expect(savePlaybackProgressActionMock).toHaveBeenCalledTimes(1);
    });
  });

  it('reports nothing for an anonymous viewer', async () => {
    renderPlayer({ signedIn: false });

    fireEvent.click(screen.getByTestId('simulate-duration'));
    fireEvent.click(screen.getByTestId('simulate-time-update'));
    fireEvent.click(screen.getByTestId('simulate-pause'));

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(savePlaybackProgressActionMock).not.toHaveBeenCalled();
  });
});
