// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import {
  VideoSourcePreview,
  type VideoSourcePreviewState,
} from '@/components/admin/media/video-source-preview';
import { episodeFormSchema } from '@/lib/contracts/episode-form';

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

/**
 * The preview confirmation.
 *
 * The browser is the only component that can prove that a source plays, so the
 * confirmation has to travel with the form: the server stores a source only
 * when the payload says that the browser verified it.
 */
function ConfirmationHarness({ defaultSource }: { defaultSource: string }): JSX.Element {
  const methods = useForm({
    defaultValues: { video_source: defaultSource, video_source_preview_confirmed: false },
  });
  const confirmed = methods.watch('video_source_preview_confirmed');

  return (
    <FormProvider {...methods}>
      <form>
        <VideoSourcePreview />
        <span data-testid="confirmed">{String(confirmed)}</span>
      </form>
    </FormProvider>
  );
}

/**
 * The confirmation as the server receives it.
 *
 * The confirmation is not just a piece of form state: it has to survive the
 * form round-trip as a boolean, because the server refuses a source whose
 * confirmation is missing — and a hidden input carries a string, not a
 * boolean.
 */
function SubmitHarness({
  defaultSource,
  onSubmit,
}: {
  defaultSource: string;
  onSubmit: (_values: unknown) => void;
}): JSX.Element {
  const methods = useForm({
    resolver: zodResolver(episodeFormSchema),
    defaultValues: {
      dramaId: '11111111-1111-4111-8111-111111111111',
      title: 'Episode 1',
      description: '',
      episode_number: '',
      season_id: '',
      video_source: defaultSource,
    },
  });
  const [previewState, setPreviewState] = useState<VideoSourcePreviewState>({
    status: 'idle',
    error: null,
  });

  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(values => onSubmit(values))}>
        <VideoSourcePreview onStateChange={setPreviewState} />
        <span data-testid="preview-status">{previewState.status}</span>
        <button type="submit">Save episode</button>
      </form>
    </FormProvider>
  );
}

describe('VideoSourcePreview — the confirmation field', () => {
  it('does not confirm a source the browser has not verified', async () => {
    render(<ConfirmationHarness defaultSource="https://media.example.com/episode.mp4" />);

    await waitFor(() => {
      expect(document.querySelector('video')).toBeTruthy();
    });

    expect(screen.getByTestId('confirmed').textContent).toBe('false');
  });

  it('confirms the source once the browser actually played it', async () => {
    render(<ConfirmationHarness defaultSource="https://media.example.com/episode.mp4" />);

    const video = getVideo();
    stubMediaElement(video);

    fireEvent.playing(video);

    await waitFor(() => {
      expect(screen.getByTestId('confirmed').textContent).toBe('true');
    });
  });

  it('withdraws the confirmation when the source fails', async () => {
    render(<ConfirmationHarness defaultSource="https://media.example.com/episode.mp4" />);

    const video = getVideo();
    stubMediaElement(video);

    fireEvent.playing(video);

    await waitFor(() => {
      expect(screen.getByTestId('confirmed').textContent).toBe('true');
    });

    Object.defineProperty(video, 'error', {
      configurable: true,
      value: { code: 3, message: 'network failure' },
    });

    fireEvent.error(video);

    await waitFor(() => {
      expect(screen.getByTestId('confirmed').textContent).toBe('false');
    });
  });
});

/**
 * The confirmation as the server receives it.
 *
 * The server stores a source only when the payload carries the confirmation,
 * and it accepts a boolean — not the string a hidden input would carry. The
 * form therefore has to hand the confirmation over as a boolean, and it has to
 * refuse to submit at all while the source is unverified.
 */
describe('VideoSourcePreview — the submitted payload', () => {
  it('submits the confirmation as a boolean once the source plays', async () => {
    const submitted: unknown[] = [];

    render(
      <SubmitHarness
        defaultSource="https://media.example.com/episode.mp4"
        onSubmit={values => submitted.push(values)}
      />
    );

    const video = getVideo();
    stubMediaElement(video);

    fireEvent.playing(video);

    await waitFor(() => {
      expect(screen.getByTestId('preview-status').textContent).toBe('verified');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save episode' }));

    await waitFor(() => {
      expect(submitted).toHaveLength(1);
    });

    const payload = submitted[0] as {
      video_source: string;
      video_source_preview_confirmed: unknown;
    };

    expect(payload.video_source).toBe('https://media.example.com/episode.mp4');
    expect(payload.video_source_preview_confirmed).toBe(true);
  });

  it('refuses to submit a source the browser has not verified', async () => {
    const submitted: unknown[] = [];

    render(
      <SubmitHarness
        defaultSource="https://media.example.com/episode.mp4"
        onSubmit={values => submitted.push(values)}
      />
    );

    await waitFor(() => {
      expect(document.querySelector('video')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save episode' }));

    await new Promise(resolve => setTimeout(resolve, 50));

    // The form did not submit: the source has no confirmation.
    expect(submitted).toHaveLength(0);
  });
});
