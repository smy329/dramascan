import 'server-only';

import { db } from '@/db/client';
import { requireUser, type ActorContext } from '@/modules/authorization';
import { savePlaybackProgress } from '@/modules/users';

/**
 * Save the viewer's playback position.
 *
 * The heartbeat is a beacon: the browser reports the position while the
 * episode plays and has to be able to do so while the page is being closed.
 * `ARCHITECTURE.md` §9.2 allocates beacons to REST with a keepalive `fetch`,
 * so the transport lives in `POST /api/playback/progress` and this workflow is
 * what sits behind it.
 *
 * The viewer is resolved from the session by the caller — a client can never
 * report progress for somebody else — and the payload is validated by the
 * module that owns the progress rows.
 *
 * The progress row and the watched-state row are written in one transaction,
 * so a viewer is never left with a position that says "watched" without a
 * matching watched state, or the other way round.
 *
 * @param actor The viewer; resolved from the session by the caller.
 * @param input The observed position, duration, and observation time.
 */
export async function savePlaybackProgressWorkflow(
  actor: ActorContext,
  input: unknown
): Promise<Awaited<ReturnType<typeof savePlaybackProgress>>> {
  // An anonymous viewer has no progress to store. The check happens before the
  // transaction so an anonymous beacon never reaches the database.
  requireUser(actor);

  return db.transaction(tx => savePlaybackProgress(actor, input, { executor: tx }));
}
