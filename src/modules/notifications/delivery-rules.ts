/**
 * The notification delivery rules (Prompt 150).
 *
 * This module is pure: it holds the rule that decides whether a notification
 * may be delivered, and nothing else. It has no database import, so the rule
 * can be unit-tested without a database and reused by every delivery path.
 *
 * The rule is a conjunction: a notification is delivered when the global
 * switch of its channel is on **and** the event preference is on. Account and
 * security notifications are mandatory and are never withheld by a switch
 * (D-005).
 */

/** The delivery channels a notification can use. */
export const NOTIFICATION_CHANNELS = ['in_app', 'push'] as const;

/** One delivery channel. */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** The five event preferences. */
export const NOTIFICATION_EVENT_PREFERENCES = [
  'new_episode',
  'new_drama',
  'new_drama_season',
  'website_announcement',
  'account_security',
] as const;

/** One event preference. */
export type NotificationEventPreference = (typeof NOTIFICATION_EVENT_PREFERENCES)[number];

/**
 * The preferences a viewer may switch off.
 *
 * `account_security` is absent on purpose: those notifications are mandatory
 * (D-005), so there is no switch for them.
 */
export const OPTIONAL_EVENT_PREFERENCES: readonly NotificationEventPreference[] = [
  'new_episode',
  'new_drama',
  'new_drama_season',
  'website_announcement',
];

/** A viewer's complete preference set. */
export type NotificationPreferenceSet = {
  newEpisode: boolean;
  newDrama: boolean;
  newDramaSeason: boolean;
  websiteAnnouncement: boolean;
  /** Always `true`: the column exists for completeness, but it cannot be switched off. */
  accountSecurity: boolean;
  globalInApp: boolean;
  globalPush: boolean;
};

/** The default preference set: everything on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceSet = {
  newEpisode: true,
  newDrama: true,
  newDramaSeason: true,
  websiteAnnouncement: true,
  accountSecurity: true,
  globalInApp: true,
  globalPush: true,
};

/** The events the rule understands. */
export type DeliveryEventType =
  | 'new_episode'
  | 'new_drama'
  | 'new_drama_season'
  | 'website_announcement'
  | 'account_security'
  | 'review_report_resolved'
  | 'content_report_resolved';

/**
 * May this notification be delivered on this channel?
 *
 * @param preferences the viewer's preference set
 * @param eventType the event the notification is about
 * @param channel the delivery channel
 * @returns whether the notification may be delivered
 */
export function isDeliveryAllowed(
  preferences: NotificationPreferenceSet,
  eventType: DeliveryEventType,
  channel: NotificationChannel
): boolean {
  // A mandatory event is never withheld by a preference switch.
  if (eventType === 'account_security') {
    return true;
  }

  if (channel === 'in_app') {
    if (!preferences.globalInApp) {
      return false;
    }
  } else if (!preferences.globalPush) {
    return false;
  }

  switch (eventType) {
    case 'new_episode':
      return preferences.newEpisode;
    case 'new_drama':
      return preferences.newDrama;
    case 'new_drama_season':
      return preferences.newDramaSeason;
    case 'website_announcement':
      return preferences.websiteAnnouncement;
    default:
      // Moderation outcomes are promised, not optional: the platform told the
      // reporter what happened, so a preference switch cannot swallow it.
      return true;
  }
}

/**
 * Does the event preference allow this event at all?
 *
 * The channel switches are not consulted: this question is "does the viewer
 * want to hear about this kind of event?", and it decides whether a
 * notification is written at all.
 *
 * @param preferences the viewer's preference set
 * @param eventType the event
 * @returns whether the event is wanted
 */
export function isEventAllowed(
  preferences: NotificationPreferenceSet,
  eventType: DeliveryEventType
): boolean {
  if (eventType === 'account_security') {
    return true;
  }

  switch (eventType) {
    case 'new_episode':
      return preferences.newEpisode;
    case 'new_drama':
      return preferences.newDrama;
    case 'new_drama_season':
      return preferences.newDramaSeason;
    case 'website_announcement':
      return preferences.websiteAnnouncement;
    default:
      return true;
  }
}

/**
 * The events the viewer always receives.
 *
 * Account and security notifications are mandatory (D-005), and a moderation
 * outcome is a promise the platform made to the reporter. None of them can be
 * switched off, so none of them are hidden by a global channel switch either.
 */
export const MANDATORY_EVENT_TYPES: readonly DeliveryEventType[] = [
  'account_security',
  'review_report_resolved',
  'content_report_resolved',
];

/**
 * Is this event mandatory, so the viewer always receives it?
 *
 * @param eventType the event
 * @returns whether the event is mandatory
 */
export function isMandatoryEvent(eventType: DeliveryEventType): boolean {
  return MANDATORY_EVENT_TYPES.includes(eventType);
}
