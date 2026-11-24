import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { AuthenticationError } from '@/platform/errors';
import type { DbExecutor } from '@/platform/db/executor';

import {
  moderation_actions,
  type ModerationActionType,
  type ModerationTargetType,
} from './schema';

/**
 * The moderation audit trail.
 *
 * Every moderator action that changes what a viewer sees is recorded here.
 * The record is written inside the caller's executor, so a workflow can write
 * the audit row and the state change it describes in one transaction: a
 * moderator never sees "the report was resolved but the audit write failed".
 *
 * Authorization is re-checked here, not only at the entrypoint. The service
 * is the security authority.
 */

/** One recorded moderation action. */
export type ModerationAction = {
  id: string;
  action: ModerationActionType;
  targetType: ModerationTargetType;
  targetId: string;
  actorUserId: string | null;
  detail: string | null;
  createdAt: Date;
};

/**
 * Record a moderation action.
 *
 * @param actor The moderator. The service checks `review.manage` itself.
 * @param action What the moderator did.
 * @param targetType The kind of target the action was performed on.
 * @param targetId The target's id, recorded as an immutable snapshot.
 * @param detail A short description, usually the resolution outcome.
 */
export async function recordModerationAction(
  actor: ActorContext,
  action: ModerationActionType,
  targetType: ModerationTargetType,
  targetId: string,
  detail: string | null,
  executor: DbExecutor = db
): Promise<ModerationAction> {
  requirePermission(actor, 'review.manage');

  const actorUserId = actor.userId;

  if (actorUserId === null) {
    throw new AuthenticationError('Authentication required.');
  }

  const [row] = await executor
    .insert(moderation_actions)
    .values({
      action,
      target_type: targetType,
      target_id: targetId,
      actor_user_id: actorUserId,
      detail,
    })
    .returning({
      id: moderation_actions.id,
      action: moderation_actions.action,
      targetType: moderation_actions.target_type,
      targetId: moderation_actions.target_id,
      actorUserId: moderation_actions.actor_user_id,
      detail: moderation_actions.detail,
      createdAt: moderation_actions.created_at,
    });

  if (!row) {
    throw new Error('The moderation action could not be recorded.');
  }

  return {
    ...row,
    action: row.action as ModerationActionType,
    targetType: row.targetType as ModerationTargetType,
  };
}
/**
 * The moderation audit trail for one target, newest first.
 */
export async function listModerationActions(
  targetType: ModerationTargetType,
  targetId: string,
  executor: DbExecutor = db
): Promise<ModerationAction[]> {
  const rows = await executor
    .select({
      id: moderation_actions.id,
      action: moderation_actions.action,
      targetType: moderation_actions.target_type,
      targetId: moderation_actions.target_id,
      actorUserId: moderation_actions.actor_user_id,
      detail: moderation_actions.detail,
      createdAt: moderation_actions.created_at,
    })
    .from(moderation_actions)
    .where(
      and(
        eq(moderation_actions.target_id, targetId),
        eq(moderation_actions.target_type, targetType)
      )
    )
    .orderBy(desc(moderation_actions.created_at));

  return rows.map(row => ({
    ...row,
    action: row.action as ModerationActionType,
    targetType: row.targetType as ModerationTargetType,
  }));
}
