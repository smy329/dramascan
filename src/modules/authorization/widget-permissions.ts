/**
 * Dashboard widget permission mapping.
 *
 * Maps each dashboard widget to the minimum permission key required to
 * render it.  The `superAdminOnly` flag ensures that Super Admin is the
 * only actor who can see the widget when it is set, regardless of other
 * permissions the actor may hold.
 *
 * Widgets whose permission key is an empty string `''` are available to
 * any actor with admin-area access.
 *
 * This is the **single source of truth** for which widgets appear where.
 * The admin overview page reads from this catalog to determine visibility;
 * never hard‑code permission checks in the UI.
 */

import { PermissionKey } from './permissions';

export type WidgetKey =
  | 'notifications'
  | 'users'
  | 'content'
  | 'moderation'
  | 'analytics';

export interface WidgetPermission {
  /** The unique widget identifier. */
  key: WidgetKey;
  /** Minimum permission key required to render the widget. */
  permission: PermissionKey;
  /** If true, only Super Admin can see this widget. */
  superAdminOnly: boolean;
}

/** All widget permission entries, in definition order. */
export const WIDGET_PERMISSIONS: readonly WidgetPermission[] = [
  // Notification center — requires review moderation permission
  {
    key: 'notifications',
    permission: 'review.manage',
    superAdminOnly: false,
  },
  // User listing — requires user read permission
  {
    key: 'users',
    permission: 'user.read',
    superAdminOnly: false,
  },
  // Content overview — requires drama manage permission
  {
    key: 'content',
    permission: 'drama.manage',
    superAdminOnly: false,
  },
  // Moderation queue — requires review manage permission
  {
    key: 'moderation',
    permission: 'review.manage',
    superAdminOnly: false,
  },
  // Analytics — requires analytics read permission (Super Admin only)
  {
    key: 'analytics',
    permission: 'analytics.read',
    superAdminOnly: true,
  },
];

/**
 * Return the widget permissions filtered for the given actor.
 *
 * Super Admin sees all non-superAdminOnly widgets plus the ones marked
 * superAdminOnly.  Non‑Super‑Admin actors only see widgets whose
 * permission they hold.
 */
export function getVisibleWidgets(
  actorPermissions: readonly PermissionKey[],
  isSuperAdmin: boolean
): readonly WidgetPermission[] {
  if (isSuperAdmin) {
    return WIDGET_PERMISSIONS;
  }
  return WIDGET_PERMISSIONS.filter(
    (w) => !w.superAdminOnly && actorPermissions.includes(w.permission)
  );
}
