'use server';

import type { ActionError } from '@/lib/contracts/common';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError };

import { resolveActor } from '@/modules/authorization';
import { parseBookmarkTarget, toggleBookmark } from '@/modules/users';

import { toActionError } from '../action-errors';

/**
 * Server Actions for a viewer's personal library.
 *
 * The actor is resolved from the session on the server, so a client can never
 * bookmark on somebody else's behalf. The target is validated by the content
 * module before the write, so a bookmark can only name content the public may
 * actually open.
 */

/** Add or remove a drama or movie from the viewer's list. */
export async function toggleBookmarkAction(
  input: unknown
): Promise<Result<{ bookmarked: boolean }>> {
  try {
    const actor = await resolveActor();
    const target = parseBookmarkTarget(input);

    const result = await toggleBookmark(actor, target);

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
