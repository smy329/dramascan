import { describe, expect, it } from 'vitest';

import {
  MAX_PLAYBACK_POSITION_SECONDS,
  MAX_PLAYBACK_WATCH_SECONDS,
  PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS,
  clampPlaybackEvent,
} from '@/modules/analytics/playback-plausibility';

/**
 * The playback plausibility rule (D-070).
 *
 * A playback beacon is public, so the server decides what it may claim. These
 * tests pin the bounds: a fabricated watch time is clamped to what the
 * visitor could have watched, and an impossible position is dropped.
 */

const NOW = new Date('2026-11-26T10:00:00.000Z');

describe('clampPlaybackEvent', () => {
  it('keeps a watch time the visitor could have watched', () => {
    const result = clampPlaybackEvent({
      watchDurationSeconds: 120,
      positionSeconds: 300,
      previousEventAt: new Date('2026-11-26T09:55:00.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(120);
    expect(result.positionSeconds).toBe(300);
  });

  it('clamps a watch time that exceeds the elapsed time', () => {
    const result = clampPlaybackEvent({
      watchDurationSeconds: 86_000,
      previousEventAt: new Date('2026-11-26T09:59:00.000Z'),
      now: NOW,
    });

    // 60 seconds elapsed, plus the tolerance.
    expect(result.watchDurationSeconds).toBe(60 + PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS);
  });

  it('allows the tolerance on top of the elapsed time', () => {
    const result = clampPlaybackEvent({
      watchDurationSeconds: 80,
      previousEventAt: new Date('2026-11-26T09:59:00.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(80);
  });

  it('clamps a watch time that no elapsed time could produce', () => {
    const result = clampPlaybackEvent({
      watchDurationSeconds: 3600,
      previousEventAt: NOW,
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS);
  });

  it('bounds the first event of a viewing session', () => {
    const result = clampPlaybackEvent({
      watchDurationSeconds: MAX_PLAYBACK_WATCH_SECONDS + 10_000,
      previousEventAt: null,
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(MAX_PLAYBACK_WATCH_SECONDS);
  });

  it('drops a watch time that is not a number', () => {
    expect(
      clampPlaybackEvent({ watchDurationSeconds: Number.NaN, now: NOW }).watchDurationSeconds
    ).toBeNull();
    expect(
      clampPlaybackEvent({ watchDurationSeconds: -5, now: NOW }).watchDurationSeconds
    ).toBeNull();
    expect(
      clampPlaybackEvent({ watchDurationSeconds: undefined, now: NOW }).watchDurationSeconds
    ).toBeNull();
  });

  it('drops a position that no title can reach', () => {
    expect(
      clampPlaybackEvent({
        positionSeconds: MAX_PLAYBACK_POSITION_SECONDS + 1,
        now: NOW,
      }).positionSeconds
    ).toBeNull();
  });

  it('drops a negative or impossible position', () => {
    expect(clampPlaybackEvent({ positionSeconds: -1, now: NOW }).positionSeconds).toBeNull();
    expect(clampPlaybackEvent({ positionSeconds: Number.POSITIVE_INFINITY, now: NOW }).positionSeconds).toBeNull();
  });

  it('treats a clock that moved backwards as no elapsed time', () => {
    const result = clampPlaybackEvent({
      watchDurationSeconds: 600,
      previousEventAt: new Date('2026-11-26T10:05:00.000Z'),
      now: NOW,
    });

    expect(result.watchDurationSeconds).toBe(PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS);
  });
});
