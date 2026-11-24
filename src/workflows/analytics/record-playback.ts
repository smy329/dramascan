'use server';

import { resolveActor } from '@/modules/authorization';
import { getPublicEpisodeContentReference, getPublicMoviePlayback } from '@/modules/content';
import {
  ensureGuestSessionId,
  parseAnalyticsPlaybackInput,
  recordPlaybackEvent,
  type PlaybackEventResult,
} from '@/modules/analytics';

/**
 * Record one playback analytics event (Prompts 141, 142).
 *
 * The player reports discrete events; the server decides what they mean. The
 * episode is resolved against the public availability rules, so an event can
 * never be attributed to an episode nobody may watch, and the drama of an
 * episode is taken from the database rather than from the browser.
 *
 * @param input the raw payload
 * @returns what the event write did
 */
export async function recordPlaybackEventWorkflow(input: unknown): Promise<PlaybackEventResult> {
  const values = parseAnalyticsPlaybackInput(input);

  const actor = await resolveActor();
  const sessionId = await ensureGuestSessionId();

  if (values.movieId !== undefined) {
    const movie = await getPublicMoviePlayback(values.movieId);

    if (!movie) {
      return { recorded: false, duplicate: false, visitor: emptyVisitor() };
    }

    return recordPlaybackEvent({
      target: { type: 'movie', movieId: values.movieId },
      eventType: values.eventType,
      positionSeconds: values.positionSeconds ?? null,
      watchDurationSeconds: values.watchDurationSeconds ?? null,
      completionThresholdMet: values.completionThresholdMet ?? false,
      userId: actor.userId,
      sessionId,
    });
  }

  const episodeId = values.episodeId;
  const dramaId = values.dramaId;

  if (episodeId === undefined || dramaId === undefined) {
    return { recorded: false, duplicate: false, visitor: emptyVisitor() };
  }

  const episode = await getPublicEpisodeContentReference(episodeId);

  if (!episode || episode.dramaId !== dramaId) {
    return { recorded: false, duplicate: false, visitor: emptyVisitor() };
  }

  return recordPlaybackEvent({
    target: { type: 'drama', episodeId, dramaId: episode.dramaId },
    eventType: values.eventType,
    positionSeconds: values.positionSeconds ?? null,
    watchDurationSeconds: values.watchDurationSeconds ?? null,
    completionThresholdMet: values.completionThresholdMet ?? false,
    userId: actor.userId,
    sessionId,
  });
}

/** The visitor placeholder for an event that was never recorded. */
function emptyVisitor(): {
  guestSessionId: string;
  sessionId: string;
  userId: string | null;
} {
  return { guestSessionId: '', sessionId: '', userId: null };
}
