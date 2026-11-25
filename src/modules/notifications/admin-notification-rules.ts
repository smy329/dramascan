/**
 * The administrator-notification audience rule (D-067).
 *
 * This module is pure on purpose: the rule that decides whether an
 * administrator may see an alert is security-relevant, so it is stated once,
 * in one place, and tested without a database.
 */

/** The audiences an alert can address. */
export const ADMIN_NOTIFICATION_AUDIENCES = ['all', 'super_admin', 'roles'] as const;

/** One alert audience. */
export type AdminNotificationAudience = (typeof ADMIN_NOTIFICATION_AUDIENCES)[number];

/**
 * The administrator as the audience rule sees them.
 *
 * It is structural on purpose: the notifications module never imports the
 * authorization module, so the notification domain stays independent of the
 * permission catalog. The workflow adapts the actor into this shape.
 */
export type AdminNotificationViewer = Readonly<{
  userId: string;
  roles: readonly string[];
  isSuperAdmin: boolean;
  /** Whether the viewer holds `admin.manage`, the alert-read permission. */
  canViewAlerts: boolean;
}>;

/** The part of an alert the audience rule reads. */
export type AdminNotificationAudienceView = Readonly<{
  audience: string;
  audienceRoles: readonly string[];
}>;

/**
 * May this viewer see this alert?
 *
 * This is the pure form of the audience rule. The SQL form in
 * `admin-notifications.ts` must agree with it; the integration tests compare
 * the two. Unknown audiences are denied.
 *
 * @param viewer the administrator
 * @param notification the alert
 * @returns whether the alert is visible to the viewer
 */
export function canViewAdminNotification(
  viewer: AdminNotificationViewer,
  notification: AdminNotificationAudienceView
): boolean {
  if (!viewer.canViewAlerts) {
    return false;
  }

  if (notification.audience === 'all') {
    return true;
  }

  if (notification.audience === 'super_admin') {
    return viewer.isSuperAdmin;
  }

  if (notification.audience === 'roles') {
    return notification.audienceRoles.some(role => viewer.roles.includes(role));
  }

  return false;
}
