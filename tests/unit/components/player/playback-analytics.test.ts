import { describe, expect, it, vi } from 'vitest';

import { createPlaybackAnalyticsReporter } from '@/components/player/playback-analytics';

/**
 * Playback analytics reporter coverage (Prompts 141, 142).
 *
 * The reporter turns the player's observations into bounded events. Two
 * properties matter: the watch time is the time the media was *playing*, and
 * an event the server dropped does not lose the watch time it carried.
 */

type FetchCall = { body: Record<string, unknown> };

function fakeFetch(result: { recorded: boolean; duplicate: boolean }) {
  const calls: FetchCall[] = [];

  const impl = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });

    return new Response(
      JSON.stringify({
        data: { recorded: result.recorded, duplicate: result.duplicate },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  return { impl, calls };
}

async function flush(): Promise<void> {
  // The reporter serialises its reports through a promise chain, so the
  // completion has to run on the macrotask queue.
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('playback analytics reporter', () => {
  it('accumulates the watch time while the media is playing', async () => {
    const { impl, calls } = fakeFetch({ recorded: true, duplicate: false });
    const reporter = createPlaybackAnalyticsReporter({
      target: { type: 'drama', episodeId: 'episode-1', dramaId: 'drama-1' },
      fetchImpl: impl as unknown as typeof fetch,
    });

    reporter.observe(0, true);
    reporter.observe(4, true);
    reporter.observe(8, true);

    expect(reporter.pendingWatchSeconds()).toBe(8);

    reporter.report('exit', { positionSeconds: 8 });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      eventType: 'exit',
      episodeId: 'episode-1',
      dramaId: 'drama-1',
      watchDurationSeconds: 8,
    });
  });

  it('does not count the time the media was paused', async () => {
    const { impl, calls } = fakeFetch({ recorded: true, duplicate: false });
    const reporter = createPlaybackAnalyticsReporter({
      target: { type: 'movie', movieId: 'movie-1' },
      fetchImpl: impl as unknown as typeof fetch,
    });

    reporter.observe(0, true);
    reporter.observe(3, true);
    // The viewer pauses: the position stops moving.
    reporter.observe(3, false);
    reporter.observe(6, false);
    // The viewer resumes.
    reporter.observe(6, true);
    reporter.observe(9, true);

    reporter.report('play_pause');
    await flush();

    expect(calls[0]?.body).toMatchObject({ watchDurationSeconds: 6 });
  });

  it('discards the jump a seek produces', async () => {
    const { impl, calls } = fakeFetch({ recorded: true, duplicate: false });
    const reporter = createPlaybackAnalyticsReporter({
      target: { type: 'movie', movieId: 'movie-1' },
      fetchImpl: impl as unknown as typeof fetch,
    });

    reporter.observe(0, true);
    reporter.observe(4, true);
    // The viewer seeks to 600 seconds. The 596 seconds in between were not
    // watched.
    reporter.observe(600, true);
    reporter.observe(604, true);

    reporter.report('seek');
    await flush();

    expect(calls[0]?.body).toMatchObject({ watchDurationSeconds: 8 });
  });

  it('keeps the watch time when the server dropped the event', async () => {
    const { impl, calls } = fakeFetch({ recorded: false, duplicate: true });
    const reporter = createPlaybackAnalyticsReporter({
      target: { type: 'movie', movieId: 'movie-1' },
      fetchImpl: impl as unknown as typeof fetch,
    });

    reporter.observe(0, true);
    reporter.observe(5, true);
    reporter.observe(10, true);

    reporter.report('play_pause');
    await flush();

    // The server stored nothing, so the watch time is still pending.
    expect(reporter.pendingWatchSeconds()).toBe(10);
    expect(calls).toHaveLength(1);
  });

  it('carries the pending watch time into the next event', async () => {
    let call = 0;
    const calls: FetchCall[] = [];

    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      call += 1;

      // The first event is a duplicate, the second one is stored.
      const recorded = call > 1;

      return new Response(
        JSON.stringify({ data: { recorded, duplicate: !recorded } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const reporter = createPlaybackAnalyticsReporter({
      target: { type: 'movie', movieId: 'movie-1' },
      fetchImpl: impl as unknown as typeof fetch,
    });

    reporter.observe(0, true);
    reporter.observe(5, true);
    reporter.observe(10, true);
    reporter.report('play_pause');
    await flush();

    reporter.observe(15, true);
    reporter.report('seek');
    await flush();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toMatchObject({ watchDurationSeconds: 10 });
    expect(calls[1]?.body).toMatchObject({ watchDurationSeconds: 15 });
    expect(reporter.pendingWatchSeconds()).toBe(0);
  });

  it('keeps the watch time when the request fails', async () => {
    const impl = vi.fn(async () => {
      throw new Error('offline');
    });

    const reporter = createPlaybackAnalyticsReporter({
      target: { type: 'movie', movieId: 'movie-1' },
      fetchImpl: impl as unknown as typeof fetch,
    });

    reporter.observe(0, true);
    reporter.observe(3, true);
    reporter.observe(7, true);
    reporter.report('exit');
    await flush();

    expect(reporter.pendingWatchSeconds()).toBe(7);
  });
});
