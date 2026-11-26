import { resolveActor } from '@/modules/authorization';
import {
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
 * from the cookie, which the route handler issued before it called this
 * workflow (D-057 §4).
 *
 * The content item is checked against the public availability rules before the
 * view is counted, so a caller cannot inflate the count of a draft by posting
 * its id.
 *
 * This workflow must never carry the `'use server'` directive: the anonymous
 * session identifier is an argument, and a Server Action argument arrives from
 * the request body. A caller could then attribute its views to another
 * visitor's session. Only the route handler calls this workflow, and the
 * route handler resolves the identifier from the cookie itself (D-031, D-083).
 *
 * @param input the raw payload
 * @param sessionId the anonymous session identifier of the request
 * @returns what the view counting did
 */
export async function recordContentViewWorkflow(
  input: unknown,
  sessionId: string
): Promise<ContentViewResult> {
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

  return recordContentView({
    type: values.type,
    contentId: values.contentId,
    userId: actor.userId,
    sessionId,
  });
}
