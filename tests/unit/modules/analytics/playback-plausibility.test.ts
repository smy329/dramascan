import { describe, expect, it } from 'vitest';

import {
  MAX_PLAYBACK_POSITION_SECONDS,
  MAX_PLAYBACK_WATCH_SECONDS,
  PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS,
  clampPlaybackPosition,
  resolvePlaybackWatchSeconds,
} from '@/modules/analytics/playback-plausibility';

/**
 * The playback plausibility rule (D-070, D-090).
 *
 * The browser reports the **cumulative** watch time of its viewing session.
 * The server keeps the cumulative watch time it has already accounted for, so
 * the first beacon of a session is measured against the moment the server
 * stamped, and a repeated claim is a delta of zero.
 *
 * These tests pin the bounds: a fabricated watch time is clamped to what the
 * visitor could have watched, a repeated claim counts nothing, and an
 * impossible position is dropped.
 */

const NOW = new Date('2026-11-26T10:00:00.000Z');

describe('resolvePlaybackWatchSeconds', () => {
  it('counts the watch time since the accounted cumulative claim', () => {
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: 180,
      accountedCumulativeSeconds: 60,
      lastEventAt: new Date('2026-11-26T09:58:00.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(120);
    expect(result.accountedCumulativeSeconds).toBe(180);
    expect(result.restarted).toBe(false);
  });

  it('counts nothing when the claim repeats what the server accounted for', () => {
    // The acknowledgement of the previous event was lost, so the browser
    // reports the same cumulative claim again. The watch time was already
    // counted, so it must not be counted twice.
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: 180,
      accountedCumulativeSeconds: 180,
      lastEventAt: new Date('2026-11-26T09:58:00.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(0);
    expect(result.accountedCumulativeSeconds).toBe(180);
    expect(result.restarted).toBe(false);
  });

  it('bounds the first claim of a session by the time since the session began', () => {
    // The server stamped the start of the session now, so a first beacon
    // cannot claim a whole day of watch time.
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: MAX_PLAYBACK_WATCH_SECONDS,
      accountedCumulativeSeconds: 0,
      startedAt: NOW,
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS);
  });

  it('clamps a claim that exceeds the elapsed time', () => {
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: 86_000,
      accountedCumulativeSeconds: 0,
      lastEventAt: new Date('2026-11-26T09:59:00.000Z'),
      now: NOW,
    });

    // 60 seconds elapsed, plus the tolerance.
    expect(result.watchDurationSeconds).toBe(60 + PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS);
  });

  it('allows the tolerance on top of the elapsed time', () => {
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: 80,
      accountedCumulativeSeconds: 0,
      lastEventAt: new Date('2026-11-26T09:59:00.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(80);
  });

  it('restarts the session when the claim goes backwards', () => {
    // The browser restarted its counter: a new viewing inside the same
    // session key. The elapsed time is measured from the restart, so the new
    // viewing cannot claim the watch time of the old one.
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: 10,
      accountedCumulativeSeconds: 300,
      lastEventAt: new Date('2026-11-26T09:00:00.000Z'),
      now: NOW,
    });

    expect(result.restarted).toBe(true);
    // The new viewing claims ten seconds, and the session restarted now, so
    // the claim is bounded by the tolerance.
    expect(result.watchDurationSeconds).toBe(10);
    expect(result.accountedCumulativeSeconds).toBe(10);
  });

  it('keeps the accounted cumulative when the claim is not a number', () => {
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: Number.NaN,
      accountedCumulativeSeconds: 120,
      lastEventAt: new Date('2026-11-26T09:58:00.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(0);
    expect(result.accountedCumulativeSeconds).toBe(120);
    expect(result.restarted).toBe(false);
  });

  it('ignores a negative claim', () => {
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: -5,
      accountedCumulativeSeconds: 120,
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(0);
    expect(result.accountedCumulativeSeconds).toBe(120);
  });

  it('treats a clock that moved backwards as no elapsed time', () => {
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: 600,
      accountedCumulativeSeconds: 0,
      lastEventAt: new Date('2026-11-26T10:05:00.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS);
  });

  it('counts a claim of a session that never reported an event', () => {
    // The session exists but has no stored event yet: the elapsed time is
    // measured from the moment the server created the session.
    const result = resolvePlaybackWatchSeconds({
      cumulativeWatchSeconds: 45,
      accountedCumulativeSeconds: 0,
      startedAt: new Date('2026-11-26T09:59:30.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(45);
  });
});

describe('clampPlaybackPosition', () => {
  it('keeps a position the viewer can reach', () => {
    expect(clampPlaybackPosition(300)).toBe(300);
  });

  it('drops a position that no title can reach', () => {
    expect(clampPlaybackPosition(MAX_PLAYBACK_POSITION_SECONDS + 1)).toBeNull();
  });

  it('drops a negative or impossible position', () => {
    expect(clampPlaybackPosition(-1)).toBeNull();
    expect(clampPlaybackPosition(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampPlaybackPosition(Number.NaN)).toBeNull();
    expect(clampPlaybackPosition(undefined)).toBeNull();
  });
});
