import 'server-only';

import { db } from '@/db/client';
import { listActiveAccountIds } from '@/modules/auth';
import { listBookmarkOwnerIds } from '@/modules/users';
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
 * The notification events (Prompts 151, 152, 153).
 *
 * Three events reach a viewer's notification center:
 *
 *   - **New episode:** a newly published episode under a drama the viewer
 *     bookmarked.
 *   - **New drama:** a newly published drama.
 *   - **New season:** a newly published season.
 *
 * Every event follows the same three rules:
 *
 *   1. **The audience is explicit.** New episodes reach the viewers who
 *      bookmarked the parent drama; new dramas and new seasons reach every
 *      active account whose preference allows it.
 *   2. **The preference decides.** A viewer who switched the event off does
 *      not receive it. The global channel switches apply as well.
 *   3. **There is no second copy.** The audience is checked against the
 *      notifications that already exist, so a repeated publication request or
 *      a retried request produces no second notification.
 *
 * There is no scheduled publishing and no recurring episode schedule: every
 * notification here follows a manual publication that just happened.
 */

/** The maximum number of viewers one event may notify. */
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

/**
 * Notify the viewers who bookmarked a drama that a new episode is available.
 *
 * @param input the episode and its drama
 * @param executor the database executor
 * @returns what the round did
 */
export async function notifyNewEpisode(
  input: {
    episodeId: string;
    episodeTitle: string;
    dramaId: string;
    dramaTitle: string;
    link: string;
  },
  executor: DbExecutor = db
): Promise<NotificationRoundResult> {
  const userIds = await listBookmarkOwnerIds(input.dramaId, MAX_AUDIENCE_SIZE, executor);

  if (userIds.length === 0) {
    return emptyRoundResult();
  }

  return deliverToAudience({
    eventType: 'new_episode',
    contentId: input.episodeId,
    userIds,
    message: {
      title: `New episode: ${input.episodeTitle}`,
      content: `${input.dramaTitle} has a new episode available.`,
      contentType: 'episode',
      link: input.link,
    },
    executor,
  });
}

/**
 * Notify the viewers that a new drama has been published.
 *
 * @param input the drama
 * @param executor the database executor
 * @returns what the round did
 */
export async function notifyNewDrama(
  input: {
    dramaId: string;
    dramaTitle: string;
    link: string;
  },
  executor: DbExecutor = db
): Promise<NotificationRoundResult> {
  return runBroadcast('new_drama', input.dramaId, {
    title: `New drama: ${input.dramaTitle}`,
    content: `${input.dramaTitle} is now available to watch.`,
    contentType: 'drama',
    link: input.link,
  }, executor);
}

/**
 * Notify the viewers that a new season has been published.
 *
 * @param input the season and its drama
 * @param executor the database executor
 * @returns what the round did
 */
export async function notifyNewSeason(
  input: {
    seasonId: string;
    seasonTitle: string;
    dramaTitle: string;
    link: string;
  },
  executor: DbExecutor = db
): Promise<NotificationRoundResult> {
  return runBroadcast('new_drama_season', input.seasonId, {
    title: `New season: ${input.seasonTitle}`,
    content: `${input.dramaTitle} has a new season available.`,
    contentType: 'season',
    link: input.link,
  }, executor);
}

/**
 * The shared broadcast: every active account is a candidate.
 *
 * @param eventType the event
 * @param contentId the content the event is about
 * @param message the notification text
 * @param executor the database executor
 * @returns what the round did
 */
async function runBroadcast(
  eventType: NotificationEventType,
  contentId: string,
  message: {
    title: string;
    content: string;
    contentType: string;
    link: string;
  },
  executor: DbExecutor
): Promise<NotificationRoundResult> {
  const userIds = await listActiveAccountIds(MAX_AUDIENCE_SIZE, executor);

  if (userIds.length === 0) {
    return emptyRoundResult();
  }

  return deliverToAudience({
    eventType,
    contentId,
    userIds,
    message,
    executor,
  });
}

/**
 * Write one notification per eligible viewer.
 *
 * The whole audience is read in three queries — the notifications that already
 * exist, the preferences, and the push subscriptions — so a broadcast does not
 * turn into thousands of round trips.
 *
 * @param input the event, the audience, and the message
 * @returns what the round did
 */
async function deliverToAudience(input: {
  eventType: NotificationEventType;
  contentId: string;
  userIds: readonly string[];
  message: {
    title: string;
    content: string;
    contentType: string;
    link: string;
  };
  executor: DbExecutor;
}): Promise<NotificationRoundResult> {
  const result = emptyRoundResult();

  const [alreadyNotified, preferences, pushRecipients] = await Promise.all([
    listAlreadyNotifiedUsers(
      input.userIds,
      input.eventType,
      input.contentId,
      input.executor
    ),
    getNotificationPreferencesForUsers(input.userIds, input.executor),
    listUsersWithSubscriptions(input.userIds, input.executor),
  ]);

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
function emptyRoundResult(): NotificationRoundResult {
  return {
    notified: 0,
    skippedAsDuplicate: 0,
    skippedByPreference: 0,
    pushAttempts: 0,
  };
}
