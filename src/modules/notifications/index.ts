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
  notifyReporter,
} from './notifications';

export type {
  NotificationEventType,
  NotificationInput,
} from './notifications';
