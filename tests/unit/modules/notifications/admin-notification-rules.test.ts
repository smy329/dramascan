import { describe, expect, it } from 'vitest';

import {
  ADMIN_NOTIFICATION_AUDIENCES,
  canViewAdminNotification,
  type AdminNotificationViewer,
} from '@/modules/notifications/admin-notification-rules';

/**
 * Administrator-notification audience rule coverage (D-067).
 *
 * The audience decides who may see an alert, and the decision is made on the
 * server for every read. These tests pin the rule itself; the integration
 * suite checks that the SQL form agrees with it.
 */

function viewer(overrides: Partial<AdminNotificationViewer> = {}): AdminNotificationViewer {
  return {
    userId: 'admin-1',
    roles: [],
    isSuperAdmin: false,
    canViewAlerts: true,
    ...overrides,
  };
}

describe('canViewAdminNotification', () => {
  it('lists the three supported audiences', () => {
    expect(ADMIN_NOTIFICATION_AUDIENCES).toEqual(['all', 'super_admin', 'roles']);
  });

  it('denies everything to an administrator who may not read alerts', () => {
    const denied = viewer({ canViewAlerts: false, isSuperAdmin: true, roles: ['moderator'] });

    expect(canViewAdminNotification(denied, { audience: 'all', audienceRoles: [] })).toBe(false);
    expect(
      canViewAdminNotification(denied, { audience: 'super_admin', audienceRoles: [] })
    ).toBe(false);
    expect(
      canViewAdminNotification(denied, { audience: 'roles', audienceRoles: ['moderator'] })
    ).toBe(false);
  });

  it('shows an `all` alert to every alert reader', () => {
    expect(canViewAdminNotification(viewer(), { audience: 'all', audienceRoles: [] })).toBe(true);
  });

  it('shows a `super_admin` alert only to the Super Admin', () => {
    expect(
      canViewAdminNotification(viewer({ isSuperAdmin: true }), {
        audience: 'super_admin',
        audienceRoles: [],
      })
    ).toBe(true);
    expect(
      canViewAdminNotification(viewer({ isSuperAdmin: false, roles: ['super_admin'] }), {
        audience: 'super_admin',
        audienceRoles: [],
      })
    ).toBe(false);
  });

  it('shows a role-addressed alert only to the named roles', () => {
    expect(
      canViewAdminNotification(viewer({ roles: ['moderator'] }), {
        audience: 'roles',
        audienceRoles: ['moderator', 'editor'],
      })
    ).toBe(true);
    expect(
      canViewAdminNotification(viewer({ roles: ['editor'] }), {
        audience: 'roles',
        audienceRoles: ['moderator'],
      })
    ).toBe(false);
    expect(
      canViewAdminNotification(viewer({ roles: [] }), {
        audience: 'roles',
        audienceRoles: ['moderator'],
      })
    ).toBe(false);
  });

  it('denies an unknown audience', () => {
    expect(
      canViewAdminNotification(viewer({ isSuperAdmin: true, roles: ['moderator'] }), {
        audience: 'everyone_on_the_internet',
        audienceRoles: ['moderator'],
      })
    ).toBe(false);
  });
});
