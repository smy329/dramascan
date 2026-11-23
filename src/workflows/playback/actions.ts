'use server';

import type { ActionError } from '@/lib/contracts/common';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError };

import { resolveActor } from '@/modules/authorization';
import { playbackFailureReportSchema, recordPlaybackFailure } from '@/modules/playback';
import { parseOrThrow } from '@/modules/content/validation';
import { parseEpisodeWatchedStateInput } from '@/modules/users';

import { toActionError } from '../action-errors';
import { setEpisodeWatchedWorkflow } from './set-episode-watched';

/**
 * Server Actions behind the viewer's player.
 *
 * The viewer has exactly one thing to report: that an external source did not
 * play. The report describes the failure and never carries the source URL, so
 * the failure table cannot become a second copy of the content table.
 *
 * The reporter is resolved from the session on the server. An anonymous
 * viewer can report a failure too — an unauthenticated report is still
 * useful — but a client can never report a failure on behalf of somebody
 * else.
 *
 * The playback position is *not* reported here: the heartbeat is a beacon
 * that has to survive the page being closed, so it travels over REST
 * (`POST /api/playback/progress`).
 */

/** Report that an episode's external source failed to play. */
export async function reportPlaybackFailureAction(input: unknown): Promise<Result<{ id: string }>> {
  try {
    const actor = await resolveActor();
    const values = parseOrThrow(playbackFailureReportSchema, input);

    const report = await recordPlaybackFailure(actor, values);

    return { ok: true, data: { id: report.id } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Mark an episode watched or unwatched manually.
 *
 * The viewer is resolved from the session, never from the payload, so the
 * change always belongs to the caller.
 */
export async function setEpisodeWatchedAction(
  input: unknown
): Promise<Result<{ watched: boolean }>> {
  try {
    const actor = await resolveActor();
    const values = parseEpisodeWatchedStateInput(input);

    const result = await setEpisodeWatchedWorkflow(actor, values.episodeId, values.watched);

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
