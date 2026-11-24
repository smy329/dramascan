import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  MANDATORY_EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_PREFERENCES,
  OPTIONAL_EVENT_PREFERENCES,
  isDeliveryAllowed,
  isEventAllowed,
  isMandatoryEvent,
  type NotificationChannel,
  type NotificationEventPreference,
  type NotificationPreferenceSet,
} from './delivery-rules';
import { notification_preferences } from './schema';

/**
 * The notification preferences (Prompt 150).
 *
 * The five event preferences are independent switches:
 *
 *   1. New episodes from bookmarked dramas.
 *   2. Newly published dramas.
 *   3. New seasons.
 *   4. Website announcements.
 *   5. Account/security notifications.
 *
 * Beside them sit the two global delivery switches: In-app On/Off and Browser
 * Push On/Off.
 *
 * The delivery rule itself is pure and lives in `delivery-rules.ts`; this
 * module owns the storage of the switches.
 */

/** The change a viewer asked for.
 *
 * Every field is optional: the update writes only what the viewer changed, so
 * two concurrent form submissions cannot silently reset each other.
 */
export type NotificationPreferenceUpdate = {
  newEpisode?: boolean;
  newDrama?: boolean;
  newDramaSeason?: boolean;
  websiteAnnouncement?: boolean;
  globalInApp?: boolean;
  globalPush?: boolean;
};

/**
 * Read a viewer's preferences.
 *
 * A viewer who has never changed anything has no preference row. That is not
 * a missing value — it is the default, which is "everything on".
 *
 * @param userId the viewer
 * @param executor the database executor
 * @returns the preference set
 */
export async function getNotificationPreferences(
  userId: string,
  executor: DbExecutor = db
): Promise<NotificationPreferenceSet> {
  const [row] = await executor
    .select({
      newEpisode: notification_preferences.new_episode,
      newDrama: notification_preferences.new_drama,
      newDramaSeason: notification_preferences.new_drama_season,
      websiteAnnouncement: notification_preferences.website_announcement,
      globalInApp: notification_preferences.global_in_app,
      globalPush: notification_preferences.global_push,
    })
    .from(notification_preferences)
    .where(
      and(
        eq(notification_preferences.user_id, userId),
        isNull(notification_preferences.deleted_at)
      )
    )
    .limit(1);

  if (!row) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  return {
    newEpisode: row.newEpisode !== false,
    newDrama: row.newDrama !== false,
    newDramaSeason: row.newDramaSeason !== false,
    websiteAnnouncement: row.websiteAnnouncement !== false,
    accountSecurity: true,
    globalInApp: row.globalInApp !== false,
    globalPush: row.globalPush !== false,
  };
}

/**
 * Read the preferences of several viewers at once.
 *
 * A broadcast can reach thousands of viewers. Reading their preferences one
 * by one would turn a single publication into thousands of queries; one
 * indexed read answers the whole audience.
 *
 * @param userIds the viewers
 * @param executor the database executor
 * @returns the preference sets, keyed by viewer
 */
export async function getNotificationPreferencesForUsers(
  userIds: readonly string[],
  executor: DbExecutor = db
): Promise<Map<string, NotificationPreferenceSet>> {
  const preferences = new Map<string, NotificationPreferenceSet>();

  if (userIds.length === 0) {
    return preferences;
  }

  const rows = await executor
    .select({
      userId: notification_preferences.user_id,
      newEpisode: notification_preferences.new_episode,
      newDrama: notification_preferences.new_drama,
      newDramaSeason: notification_preferences.new_drama_season,
      websiteAnnouncement: notification_preferences.website_announcement,
      globalInApp: notification_preferences.global_in_app,
      globalPush: notification_preferences.global_push,
    })
    .from(notification_preferences)
    .where(
      and(
        inArray(notification_preferences.user_id, [...userIds]),
        isNull(notification_preferences.deleted_at)
      )
    );

  for (const row of rows) {
    preferences.set(row.userId, {
      newEpisode: row.newEpisode !== false,
      newDrama: row.newDrama !== false,
      newDramaSeason: row.newDramaSeason !== false,
      websiteAnnouncement: row.websiteAnnouncement !== false,
      accountSecurity: true,
      globalInApp: row.globalInApp !== false,
      globalPush: row.globalPush !== false,
    });
  }

  return preferences;
}

/**
 * Save a viewer's preferences.
 *
 * The row is created on the first save. An existing row is updated in place,
 * so the viewer's settings survive a browser reload and a new device.
 *
 * @param userId the viewer
 * @param update the changed preferences
 * @param executor the database executor
 * @returns the saved preference set
 */
export async function updateNotificationPreferences(
  userId: string,
  update: NotificationPreferenceUpdate,
  executor: DbExecutor = db
): Promise<NotificationPreferenceSet> {
  const values = {
    new_episode: update.newEpisode,
    new_drama: update.newDrama,
    new_drama_season: update.newDramaSeason,
    website_announcement: update.websiteAnnouncement,
    global_in_app: update.globalInApp,
    global_push: update.globalPush,
  };

  await executor
    .insert(notification_preferences)
    .values({
      user_id: userId,
      new_episode: values.new_episode ?? true,
      new_drama: values.new_drama ?? true,
      new_drama_season: values.new_drama_season ?? true,
      website_announcement: values.website_announcement ?? true,
      account_security: true,
      global_in_app: values.global_in_app ?? true,
      global_push: values.global_push ?? true,
    })
    .onConflictDoUpdate({
      // The conflict target is a *partial* unique index: one active preference
      // row per viewer. PostgreSQL only infers a partial index when the
      // statement repeats the whole index predicate.
      target: notification_preferences.user_id,
      targetWhere: sql`${notification_preferences.deleted_at} IS NULL`,
      set: {
        ...values.new_episode === undefined ? {} : { new_episode: values.new_episode },
        ...values.new_drama === undefined ? {} : { new_drama: values.new_drama },
        ...values.new_drama_season === undefined
          ? {}
          : { new_drama_season: values.new_drama_season },
        ...values.website_announcement === undefined
          ? {}
          : { website_announcement: values.website_announcement },
        ...values.global_in_app === undefined ? {} : { global_in_app: values.global_in_app },
        ...values.global_push === undefined ? {} : { global_push: values.global_push },
        updated_at: sql`now()`,
      },
    });

  return getNotificationPreferences(userId, executor);
}

export {
  DEFAULT_NOTIFICATION_PREFERENCES,
  MANDATORY_EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_PREFERENCES,
  OPTIONAL_EVENT_PREFERENCES,
  isDeliveryAllowed,
  isEventAllowed,
  isMandatoryEvent,
};

export type {
  NotificationChannel,
  NotificationEventPreference,
  NotificationPreferenceSet,
};
