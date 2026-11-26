import 'server-only';

import { db } from '@/db/client';
import { listActiveAccountIds } from '@/modules/auth';
import { listBookmarkOwnerIds } from '@/modules/users';
import type { DbExecutor } from '@/platform/db/executor';

import {
  MAX_AUDIENCE_SIZE,
  deliverToAudience,
  emptyRoundResult,
  type NotificationRoundResult,
} from './audience';
import type { NotificationEventType } from './notifications';

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
