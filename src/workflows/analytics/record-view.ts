'use server';

import { resolveActor } from '@/modules/authorization';
import {
  ensureGuestSessionId,
  isPublicAnalyticsTarget,
  parseAnalyticsViewInput,
  recordContentView,
  type ContentViewResult,
} from '@/modules/analytics';

/**
 * Count one view of a content item (Prompt 140).
 *
 * The workflow is the only place that knows how a visitor is identified. The
 * account comes from the server-side session; the anonymous session comes
 * from the cookie, which is created here because a Route Handler — not a
 * Server Component — is the only place that may write a cookie.
 *
 * The content item is checked against the public availability rules before the
 * view is counted, so a caller cannot inflate the count of a draft by posting
 * its id.
 *
 * @param input the raw payload
 * @returns what the view counting did
 */
export async function recordContentViewWorkflow(input: unknown): Promise<ContentViewResult> {
  const values = parseAnalyticsViewInput(input);

  const publicTarget = await isPublicAnalyticsTarget(values.type, values.contentId);

  if (!publicTarget) {
    // The title is not public. There is no view to count, and the response
    // tells the caller so without leaking whether the title exists.
    return {
      counted: false,
      alreadyCounted: false,
      visitor: { guestSessionId: '', sessionId: '', userId: null },
    };
  }

  const actor = await resolveActor();
  const sessionId = await ensureGuestSessionId();

  return recordContentView({
    type: values.type,
    contentId: values.contentId,
    userId: actor.userId,
    sessionId,
  });
}
