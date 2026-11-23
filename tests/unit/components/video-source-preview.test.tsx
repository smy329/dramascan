// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { useEffect } from 'react';

import {
  VideoSourcePreview,
  type VideoSourcePreviewState,
} from '@/components/admin/media/video-source-preview';

/**
 * The administrator's playback preview.
 *
 * The preview is the only thing that can prove that an external URL plays:
 * the server never fetches it, and an `.mp4` suffix proves nothing. The
 * component therefore has to report what the *browser* actually did — a
 * `playing` event is evidence, a `canplay` event is not — and it has to
 * survive the source changing from empty to filled, which is the normal path
 * an administrator takes.
 */

type HarnessProps = {
  defaultSource?: string;
  onState?: (_state: VideoSourcePreviewState) => void;
};

function Harness({ defaultSource = '', onState }: HarnessProps) {
  const methods = useForm({ defaultValues: { video_source: defaultSource } });
  const { reset } = methods;

  // `useForm` only reads `defaultValues` on the first render, so a changed
  // default has to be pushed into the form explicitly — that is what happens
  // when the administrator edits the URL field.
  useEffect(() => {
    reset({ video_source: defaultSource });
  }, [defaultSource, reset]);

  return (
    <FormProvider {...methods}>
      <VideoSourcePreview onStateChange={onState} />
    </FormProvider>
  );
}

/** Make the media element behave enough like a browser for the test. */
function stubMediaElement(video: HTMLVideoElement, duration = 0): void {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => duration,
  });

  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    writable: true,
    value: 0,
  });

  video.load = vi.fn();
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn();
}

function getVideo(): HTMLVideoElement {
  const video = document.querySelector('video');

  if (!video) {
    throw new Error('The preview did not render a media element.');
  }

  return video;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VideoSourcePreview', () => {
  it('renders without a source and does not break when a source is entered', async () => {
    const { rerender } = render(<Harness defaultSource="" />);

    expect(screen.getByText(/Enter a direct HTTPS MP4 URL/i)).toBeTruthy();

    // The administrator types a URL: the component goes from "no source" to
    // "has source". Every hook has to run in both renders.
    rerender(<Harness defaultSource="https://media.example.com/episode.mp4" />);

    await waitFor(() => {
      expect(document.querySelector('video')).toBeTruthy();
    });
  });

  it('reports that playback is not yet verified while the source is loading', async () => {
    const states: VideoSourcePreviewState[] = [];

    render(
      <Harness
        defaultSource="https://media.example.com/episode.mp4"
        onState={state => states.push(state)}
      />
    );

    await waitFor(() => {
      expect(states.some(state => state.status === 'loading')).toBe(true);
    });
  });

  it('marks the source verified only after the browser actually plays it', async () => {
    const states: VideoSourcePreviewState[] = [];

    render(
      <Harness
        defaultSource="https://media.example.com/episode.mp4"
        onState={state => states.push(state)}
      />
    );

    const video = getVideo();
    stubMediaElement(video);

    fireEvent.playing(video);

    await waitFor(() => {
      expect(states.at(-1)?.status).toBe('verified');
    });
  });

  it('does not treat a canplay event as proof of playback', async () => {
    const states: VideoSourcePreviewState[] = [];

    render(
      <Harness
        defaultSource="https://media.example.com/episode.mp4"
        onState={state => states.push(state)}
      />
    );

    const video = getVideo();
    stubMediaElement(video);

    fireEvent.canPlay(video);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(states.some(state => state.status === 'verified')).toBe(false);
  });

  it('reports a network failure with an explanation', async () => {
    const states: VideoSourcePreviewState[] = [];

    render(
      <Harness
        defaultSource="https://media.example.com/episode.mp4"
        onState={state => states.push(state)}
      />
    );

    const video = getVideo();
    stubMediaElement(video);

    Object.defineProperty(video, 'error', {
      configurable: true,
      value: { code: 3, message: 'network failure' },
    });

    fireEvent.error(video);

    await waitFor(() => {
      expect(states.at(-1)?.status).toBe('failed');
    });

    expect(states.at(-1)?.error).toMatch(/cross-origin|CORS|load/i);
  });

  it('reports an unsupported source with an explanation', async () => {
    const states: VideoSourcePreviewState[] = [];

    render(
      <Harness
        defaultSource="https://media.example.com/episode.mp4"
        onState={state => states.push(state)}
      />
    );

    const video = getVideo();
    stubMediaElement(video);

    Object.defineProperty(video, 'error', {
      configurable: true,
      value: { code: 4, message: 'decode failure' },
    });

    fireEvent.error(video);

    await waitFor(() => {
      expect(states.at(-1)?.status).toBe('failed');
    });

    expect(states.at(-1)?.error).toMatch(/decode|unsupported|format/i);
  });

  it('clears a previous failure when the source changes', async () => {
    const states: VideoSourcePreviewState[] = [];

    const { rerender } = render(
      <Harness
        defaultSource="https://media.example.com/episode.mp4"
        onState={state => states.push(state)}
      />
    );

    const video = getVideo();
    stubMediaElement(video);

    Object.defineProperty(video, 'error', {
      configurable: true,
      value: { code: 3, message: 'network failure' },
    });

    fireEvent.error(video);

    await waitFor(() => {
      expect(states.at(-1)?.status).toBe('failed');
    });

    rerender(
      <Harness
        defaultSource="https://media.example.com/other.mp4"
        onState={state => states.push(state)}
      />
    );

    await waitFor(() => {
      expect(states.at(-1)?.status).toBe('loading');
    });
  });

  it("requests the media cross-origin, like the viewer's player does", async () => {
    render(<Harness defaultSource="https://media.example.com/episode.mp4" />);

    await waitFor(() => {
      expect(document.querySelector('video')).toBeTruthy();
    });

    // The preview has to test the source under the same conditions the
    // viewer will meet. Without a CORS-enabled request the preview would
    // pass for a host the player rejects.
    expect(getVideo().getAttribute('crossorigin')).toBe('anonymous');
  });

  it('explains that a successful save is not proof of playback', async () => {
    render(<Harness defaultSource="https://media.example.com/episode.mp4" />);

    expect(screen.getByText(/not proof of playback/i)).toBeTruthy();
  });

  it('verifies that the source can be seeked when the duration is known', async () => {
    const states: VideoSourcePreviewState[] = [];

    render(
      <Harness
        defaultSource="https://media.example.com/episode.mp4"
        onState={state => states.push(state)}
      />
    );

    const video = getVideo();
    stubMediaElement(video, 100);

    fireEvent.playing(video);

    // The preview seeks to 75 % of the duration. The browser only reports the
    // new position once the host has actually served the range.
    await waitFor(() => {
      expect(video.currentTime).toBeCloseTo(75);
    });

    fireEvent.seeked(video);

    await waitFor(() => {
      expect(states.at(-1)?.status).toBe('verified');
    });
  });

  it('fails when the source cannot be seeked', async () => {
    const states: VideoSourcePreviewState[] = [];

    render(
      <Harness
        defaultSource="https://media.example.com/episode.mp4"
        onState={state => states.push(state)}
      />
    );

    const video = getVideo();
    stubMediaElement(video, 100);

    fireEvent.playing(video);

    // The host never answers the range request, so the position never lands.
    await waitFor(
      () => {
        expect(states.at(-1)?.status).toBe('failed');
      },
      { timeout: 6000 }
    );

    expect(states.at(-1)?.error).toMatch(/byte-range|seek/i);
  });
});
