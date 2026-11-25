/**
 * Notifications module public API (server-only).
 *
 * The single public surface for the notifications domain. Callers get the
 * notification writes they are allowed to use, not the module's schema or
 * inner helpers.
 */

import 'server-only';

export {
  NOTIFICATION_EVENT_TYPES,
  acceptsNotification,
  createNotification,
  notifyAccountSecurity,
  notifyReporter,
  writeNotificationOnce,
} from './notifications';

export type {
  NotificationEventType,
  NotificationInput,
  NotificationWriteOutcome,
} from './notifications';

export {
  DEFAULT_NOTIFICATION_PREFERENCES,
  MANDATORY_EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_PREFERENCES,
  OPTIONAL_EVENT_PREFERENCES,
  getNotificationPreferences,
  getNotificationPreferencesForUsers,
  isDeliveryAllowed,
  isEventAllowed,
  isMandatoryEvent,
  updateNotificationPreferences,
} from './preferences';

export type {
  NotificationChannel,
  NotificationEventPreference,
  NotificationPreferenceSet,
  NotificationPreferenceUpdate,
} from './preferences';

export {
  dismissNotification,
  getNotificationCenter,
  getUnreadNotificationCount,
  hasNotificationFor,
  listAlreadyNotifiedUsers,
  markAllNotificationsRead,
  markNotificationRead,
} from './notification-center';

export type { NotificationCenter, NotificationView } from './notification-center';

export {
  MAX_SUBSCRIPTIONS_PER_USER,
  listDeliverableSubscriptions,
  listSubscriptions,
  listUsersWithSubscriptions,
  removeAllSubscriptions,
  removeSubscription,
  retireExpiredSubscription,
  saveSubscription,
} from './subscriptions';

export type { PushSubscription } from './subscriptions';

export {
  PUSH_PROVIDERS,
  createFcmProvider,
  createWebPushProvider,
  getBrowserPushPublicKey,
  isBrowserPushAvailable,
  resolvePushProvider,
} from './push-provider';

export type {
  PushDeliveryResult,
  PushMessage,
  PushProvider,
  PushProviderName,
  PushSubscriptionPayload,
} from './push-provider';

export {
  DELIVERY_RETENTION_DAYS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_PUSH_RETRY_ATTEMPTS,
  PUSH_RETRY_WINDOW_DAYS,
  deleteInvalidNotifications,
  deleteOldDeliveries,
  deleteOrphanedDeliveries,
  deliverPush,
  listDeliveries,
  markInAppDelivered,
  retryFailedPushDeliveries,
  runNotificationMaintenance,
} from './delivery';

export type {
  DeliveryOutcome,
  NotificationMaintenanceResult,
  NotificationRetryResult,
} from './delivery';

export {
  countPushAttempts,
  hasSuccessfulPushDelivery,
  recordDelivery,
} from './delivery-records';

export type { DeliveryChannel, DeliveryRecordInput } from './delivery-records';

export {
  MAX_AUDIENCE_SIZE,
  notifyNewDrama,
  notifyNewEpisode,
  notifyNewSeason,
  notifyPublishedContent,
} from './events';

export type { NotificationRoundResult, PublishableContentType } from './events';

export {
  ANNOUNCEMENT_CONTENT_MAX_LENGTH,
  ANNOUNCEMENT_LIST_LIMIT,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  createAnnouncement,
  listAnnouncements,
  listPublishedAnnouncements,
  publishAnnouncement,
} from './announcements';

export type {
  AnnouncementInput,
  AnnouncementPublicationResult,
  AnnouncementStatus,
  AnnouncementView,
} from './announcements';

export {
  ADMIN_NOTIFICATION_AUDIENCES,
  ADMIN_NOTIFICATION_CATEGORIES,
  ADMIN_NOTIFICATION_CONTENT_MAX_LENGTH,
  ADMIN_NOTIFICATION_PAGE_SIZE,
  ADMIN_NOTIFICATION_PRIORITIES,
  ADMIN_NOTIFICATION_TITLE_MAX_LENGTH,
  canViewAdminNotification,
  countUnreadAdminNotifications,
  createAdminNotification,
  getAdminNotification,
  listAdminNotifications,
  setAdminNotificationRead,
} from './admin-notifications';

export type {
  AdminNotificationAudience,
  AdminNotificationCategory,
  AdminNotificationInput,
  AdminNotificationPage,
  AdminNotificationPriority,
  AdminNotificationView,
  AdminNotificationViewer,
} from './admin-notifications';
