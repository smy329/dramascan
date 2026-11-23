'use server';

import type { ActionError } from '@/lib/contracts/common';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError };

import { db } from '@/db/client';
import { resolveActor } from '@/modules/authorization';
import { playbackFailureReportSchema, recordPlaybackFailure } from '@/modules/playback';
import { parseOrThrow } from '@/modules/content/validation';
import { savePlaybackProgress } from '@/modules/users';

import { toActionError } from '../action-errors';

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
 */

/** Report that an episode's external source failed to play. */
export async function reportPlaybackFailureAction(input: unknown): Promise<Result<{ id: string }>> {
  try {
    const actor = await resolveActor();
    const values = parseOrThrow(playbackFailureReportSchema, input);

    const report = await recordPlaybackFailure(values, actor.userId);

    return { ok: true, data: { id: report.id } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Store the viewer's playback position.
 *
 * The action is the only way into the progress write. The viewer is resolved
 * from the session on the server — a client can never report progress for
 * somebody else — and the payload is validated by the module that owns the
 * progress rows.
 *
 * The progress row and the watched-state row are written in one transaction,
 * so a viewer is never left with a position that says "watched" without a
 * matching watched state, or the other way round.
 */
export async function savePlaybackProgressAction(
  input: unknown
): Promise<
  Result<{
    applied: boolean;
    positionSeconds: number;
    durationSeconds: number;
    thresholdMet: boolean;
  }>
> {
  try {
    const actor = await resolveActor();

    const result = await db.transaction(tx => savePlaybackProgress(actor, input, { executor: tx }));

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
