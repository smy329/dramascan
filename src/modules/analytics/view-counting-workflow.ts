import 'server-only';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';
import { isForeignKeyViolation, isUniqueViolation } from '@/platform/db/errors';

import { content_view_events } from './schema';
import { utcHourBucket } from './date-filters';
import { viewTargetIdExpression, viewTargetTypeExpression } from './typed-targets';
import { analyticsViewerType } from './viewer-types';
import { resolveAnalyticsVisitor, type AnalyticsVisitor } from './visitor';

/**
 * The view-counting workflow (Prompt 140, D-002).
 *
 * A view is counted when a visitor opens a drama or movie details page, at
 * most once per visitor per content item during a rolling six-hour window.
 *
 * The window is enforced in two layers:
 *
 *   1. **The application check.** Before counting, the workflow looks for a
 *      view of the same content item by the same visitor inside the last six
 *      hours. A refresh inside the window does not count again; a visit after
 *      the window does.
 *   2. **The database safety net.** A partial unique index on
 *      `(content_id, content_type, guest_session_id, viewed_hour_bucket)`
 *      stops two concurrent requests from counting the same view twice.
 *
 * The visitor is the anonymous guest session or the signed-in account; the
 * event row itself carries only the `guest_sessions` row id, so no personal
 * identifier reaches the event table.
 */

/** The length of the rolling deduplication window, in hours (D-002). */
export const VIEW_DEDUP_WINDOW_HOURS = 6;

/** The result of one view-counting attempt. */
export type ContentViewResult = {
  /** Whether a new view was counted. */
  counted: boolean;
  /** Whether the view was suppressed because the window was still open. */
  alreadyCounted: boolean;
  /** The visitor the view was attributed to. */
  visitor: AnalyticsVisitor;
};

/**
 * Count one view of a content item.
 *
 * The window check and the insert run in **one transaction**, behind a lock
 * that is scoped to the visitor and the title. Two requests that arrive at the
 * same time therefore queue instead of interleaving: the second one sees the
 * row the first one wrote and counts nothing. The hourly unique index stays
 * as the database-level safety net (D-058).
 *
 * @param input the content item, the visitor, and the moment of the view
 * @returns whether the view was counted
 */
export async function recordContentView(input: {
  type: 'drama' | 'movie';
  contentId: string;
  userId: string | null;
  sessionId: string;
  now?: Date;
}): Promise<ContentViewResult> {
  const now = input.now ?? new Date();
  const visitor = await resolveAnalyticsVisitor({
    userId: input.userId,
    sessionId: input.sessionId,
  });

  const windowStart = new Date(now.getTime() - VIEW_DEDUP_WINDOW_HOURS * 60 * 60 * 1000);

  try {
    return await db.transaction(async tx => {
      await lockViewWindow(tx, visitor.guestSessionId, input.type, input.contentId);

      const [recent] = await tx
        .select({ id: content_view_events.id })
        .from(content_view_events)
        .where(
          and(
            // The window looks for the same content item, and the typed target is
            // what says which content item a row is about (D-032 §4, D-082).
            sql`${viewTargetTypeExpression} = ${input.type}`,
            sql`${viewTargetIdExpression} = ${input.contentId}`,
            eq(content_view_events.guest_session_id, visitor.guestSessionId),
            gt(content_view_events.viewed_at, windowStart),
            isNull(content_view_events.deleted_at)
          )
        )
        .limit(1);

      if (recent) {
        return { counted: false, alreadyCounted: true, visitor };
      }

      await tx.insert(content_view_events).values({
        guest_session_id: visitor.guestSessionId,
        viewer_type: analyticsViewerType(input.userId),
        content_id: input.contentId,
        content_type: input.type,
        drama_id: input.type === 'drama' ? input.contentId : null,
        movie_id: input.type === 'movie' ? input.contentId : null,
        viewed_at: now,
        viewed_hour_bucket: utcHourBucket(now),
      });

      return { counted: true, alreadyCounted: false, visitor };
    });
  } catch (error) {
    // Two concurrent requests counted the same view. The unique index caught
    // the race; the view is counted once.
    if (isUniqueViolation(error)) {
      return { counted: false, alreadyCounted: true, visitor };
    }

    // The content item was deleted between the availability check and this
    // insert. The view belongs to a title that no longer exists, so it is not
    // counted — and the beacon is fire-and-forget, so this is a normal
    // outcome rather than a server error.
    if (isForeignKeyViolation(error)) {
      return { counted: false, alreadyCounted: false, visitor };
    }

    throw error;
  }
}

/**
 * Serialize the window checks of one visitor and one title.
 *
 * The lock is transaction-scoped: it is taken when the transaction starts and
 * released when it commits, so a failed request never leaves a lock behind.
 * The key is scoped to the visitor and the title, so the views of two
 * different titles never wait for each other.
 *
 * @param executor the transaction
 * @param guestSessionId the visitor
 * @param type the content type
 * @param contentId the content item
 */
async function lockViewWindow(
  executor: DbExecutor,
  guestSessionId: string,
  type: 'drama' | 'movie',
  contentId: string
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${viewWindowLockKey(guestSessionId, type, contentId)}))`
  );
}

/**
 * The lock key of the window check of one visitor and one title.
 *
 * @param guestSessionId the visitor
 * @param type the content type
 * @param contentId the content item
 * @returns the key
 */
export function viewWindowLockKey(
  guestSessionId: string,
  type: 'drama' | 'movie',
  contentId: string
): string {
  return `analytics:view:${guestSessionId}:${type}:${contentId}`;
}
