import {
  hasPermission,
  toPermissionKey,
  type ActorContext,
} from '@/modules/authorization';
import type { AdminNotificationViewer } from '@/modules/notifications';

/**
 * Adapt an actor to the structural viewer the notification module accepts.
 *
 * The notification module deliberately does not import the authorization
 * module, so the adaptation lives here: both the page and the server action use
 * the same rule, and neither can drift from the other.
 */
export function toAdminNotificationViewer(
  actor: ActorContext
): AdminNotificationViewer | null {
  if (actor.userId === null) {
    return null;
  }

  const canViewAlerts = hasPermission(actor, toPermissionKey('admin', 'manage'));

  if (!canViewAlerts) {
    return null;
  }

  return {
    userId: actor.userId,
    roles: actor.roles,
    isSuperAdmin: actor.isSuperAdmin,
    canViewAlerts,
  };
}
