import 'server-only';

import { db } from '@/db/client';
import { requireUser, type ActorContext } from '@/modules/authorization';
import { setEpisodeWatchedState } from '@/modules/users';

/**
 * Mark one episode watched or unwatched.
 *
 * The viewer is resolved from the session by the caller. The watched-state row
 * and the playback-progress row are written in one transaction, so a viewer is
 * never left with a manual "watched" decision that the stored position
 * contradicts, or the other way round.
 *
 * @param actor     The viewer; resolved from the session by the caller.
 * @param episodeId The episode to change.
 * @param watched   The desired state.
 */
export async function setEpisodeWatchedWorkflow(
  actor: ActorContext,
  episodeId: string,
  watched: boolean
): Promise<{ watched: boolean }> {
  requireUser(actor);

  return db.transaction(tx =>
    setEpisodeWatchedState(actor, episodeId, watched, { executor: tx })
  );
}
