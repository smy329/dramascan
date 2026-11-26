import 'server-only';

import type { DbExecutor } from '@/platform/db/executor';

import { writeNotificationOnce, type NotificationEventType } from './notifications';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isDeliveryAllowed,
  isEventAllowed,
} from './delivery-rules';
import {
  getNotificationPreferencesForUsers,
  type NotificationPreferenceSet,
} from './preferences';
import { listAlreadyNotifiedUsers } from './notification-center';
import { listUsersWithSubscriptions } from './subscriptions';
import { deliverPush } from './delivery';

/**
 * The shared audience delivery (Prompts 151, 152, 153).
 *
 * Every broadcast ends the same way: one notification per eligible viewer,
 * and a browser-push delivery for the viewers whose subscription and
 * preferences allow it. The rule lives here once, so the episode, drama,
 * season, and announcement rounds cannot drift apart.
 *
 * The whole audience is read in three queries — the notifications that already
 * exist, the preferences, and the push subscriptions — so a broadcast does not
 * turn into thousands of round trips. The three reads run one after the
 * other: the executor may be a transaction handle, and a transaction is bound
 * to one PostgreSQL connection that may run one query at a time
 * (CONVENTIONS §5.6).
 */

/**
 * The maximum number of viewers one broadcast may notify.
 *
 * The audience is read in one query and held in memory, so the bound keeps a
 * broadcast from turning into an unbounded amount of work. The audience is
 * capped, not paginated: a viewer beyond the bound is not notified, and the
 * result says how many were reached.
 */
export const MAX_AUDIENCE_SIZE = 5000;

/** What one notification round did. */
export type NotificationRoundResult = {
  /** How many viewers received an in-app notification. */
  notified: number;
  /** How many viewers were skipped because they already had the notification. */
  skippedAsDuplicate: number;
  /** How many viewers were skipped because their preference did not allow it. */
  skippedByPreference: number;
  /** How many browser-push deliveries were attempted. */
  pushAttempts: number;
};

/** The message one notification carries. */
export type AudienceNotificationMessage = {
  title: string;
  content: string;
  contentType: string;
  link: string;
};

/** One audience delivery. */
export type AudienceDeliveryInput = {
  /** The event the notifications are about. */
  eventType: NotificationEventType;
  /** The content the event is about; it is part of the de-duplication key. */
  contentId: string;
  /** The viewers the event may reach. */
  userIds: readonly string[];
  /** The message every viewer receives. */
  message: AudienceNotificationMessage;
  /** The database executor. */
  executor: DbExecutor;
};

/**
 * Write one notification per eligible viewer.
 *
 * @param input the event, the audience, and the message
 * @returns what the round did
 */
export async function deliverToAudience(
  input: AudienceDeliveryInput
): Promise<NotificationRoundResult> {
  const result: NotificationRoundResult = {
    notified: 0,
    skippedAsDuplicate: 0,
    skippedByPreference: 0,
    pushAttempts: 0,
  };

  const alreadyNotified = await listAlreadyNotifiedUsers(
    input.userIds,
    input.eventType,
    input.contentId,
    input.executor
  );

  const preferences = await getNotificationPreferencesForUsers(input.userIds, input.executor);

  const pushRecipients = await listUsersWithSubscriptions(input.userIds, input.executor);

  for (const userId of input.userIds) {
    // The bulk read avoids a write attempt for an audience that has already
    // been told. It is an optimisation, not the guarantee: the partial unique
    // index behind `writeNotificationOnce` is what makes a concurrent retry
    // safe.
    if (alreadyNotified.has(userId)) {
      result.skippedAsDuplicate += 1;
      continue;
    }

    const set: NotificationPreferenceSet =
      preferences.get(userId) ?? { ...DEFAULT_NOTIFICATION_PREFERENCES };

    if (!isEventAllowed(set, input.eventType)) {
      result.skippedByPreference += 1;
      continue;
    }

    const notification = await writeNotificationOnce(
      {
        userId,
        title: input.message.title,
        content: input.message.content,
        eventType: input.eventType,
        contentId: input.contentId,
        contentType: input.message.contentType,
        link: input.message.link,
      },
      set,
      input.executor
    );

    if (notification.status === 'duplicate') {
      result.skippedAsDuplicate += 1;
      continue;
    }

    if (notification.status !== 'created') {
      result.skippedByPreference += 1;
      continue;
    }

    result.notified += 1;

    if (isDeliveryAllowed(set, input.eventType, 'push') && pushRecipients.has(userId)) {
      result.pushAttempts += 1;
      await deliverPush(notification.id, input.executor, set);
    }
  }

  return result;
}

/** A round that notified nobody. */
export function emptyRoundResult(): NotificationRoundResult {
  return {
    notified: 0,
    skippedAsDuplicate: 0,
    skippedByPreference: 0,
    pushAttempts: 0,
  };
}
