import { expect, test, type BrowserContext } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import { removeNotifications, seedNotification } from './support/notification-fixture.mjs';

/**
 * Browser coverage for the notification centre, the notification preferences,
 * and the unread bell (Prompts 148, 149, 150).
 *
 * The session is seeded through the test-only helper and the notification rows
 * through the test-only fixture, so the application performs its real session
 * lookup, its real notification reads, and its real mark-read writes. What is
 * asserted is what a browser actually receives: the viewer's own history, the
 * unread count on the bell, the persistence of a mark-read, and the
 * persistence of a saved preference.
 */

/** Sign the browser in with a seeded session. */
async function signIn(context: BrowserContext, session: { cookieName: string; cookieValue: string }) {
  await context.addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('notification centre', () => {
  test('shows the viewer’s own notifications and marks one as read', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-notification-centre@example.com',
      superAdmin: false,
    });

    try {
      await seedNotification({
        userId: session.userId,
        title: 'A drama you follow has a new episode',
        content: 'Episode 4 is now available.',
        eventType: 'new_episode',
        link: '/drama',
      });

      await signIn(context, session);
      await page.goto('/notifications');

      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
      await expect(page.getByText('A drama you follow has a new episode')).toBeVisible();
      await expect(page.getByText('Episode 4 is now available.')).toBeVisible();

      // The unread notification is offered a mark-read control.
      await page.getByRole('button', { name: 'Mark as read' }).click();

      // The mark really reached the database: a reload still shows it as read.
      await page.reload();
      await expect(page.getByText('A drama you follow has a new episode')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
    } finally {
      await removeNotifications(session.userId);
      await adminSession.remove(session.userId);
    }
  });

  test('keeps another viewer’s notification out of the centre', async ({ context, page }) => {
    const owner = await adminSession.seed({
      email: 'e2e-notification-owner@example.com',
      superAdmin: false,
    });
    const other = await adminSession.seed({
      email: 'e2e-notification-other@example.com',
      superAdmin: false,
    });

    try {
      await seedNotification({
        userId: owner.userId,
        title: 'Private to the first viewer',
        content: 'This message belongs to somebody else.',
      });

      await signIn(context, other);
      await page.goto('/notifications');

      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
      await expect(page.getByText('Private to the first viewer')).toHaveCount(0);
      await expect(page.getByText('No notifications yet')).toBeVisible();
    } finally {
      await removeNotifications(owner.userId);
      await removeNotifications(other.userId);
      await adminSession.remove(owner.userId);
      await adminSession.remove(other.userId);
    }
  });

  test('shows the unread count on the bell', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-notification-bell@example.com',
      superAdmin: false,
    });

    try {
      await seedNotification({
        userId: session.userId,
        title: 'Unread one',
        content: 'This one is unread.',
      });
      await seedNotification({
        userId: session.userId,
        title: 'Unread two',
        content: 'This one is unread too.',
      });

      await signIn(context, session);
      await page.goto('/');

      const bell = page.getByRole('link', { name: /2 unread notifications/ });
      await expect(bell).toBeVisible();
      await expect(bell).toContainText('2');
    } finally {
      await removeNotifications(session.userId);
      await adminSession.remove(session.userId);
    }
  });
});

test.describe('notification preferences', () => {
  test('saves a preference and keeps it after a reload', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-notification-preferences@example.com',
      superAdmin: false,
    });

    try {
      await signIn(context, session);
      await page.goto('/settings/notifications');

      await expect(page.getByRole('heading', { name: 'Notification preferences' })).toBeVisible();

      const newEpisodes = page.getByRole('switch', { name: 'New episodes' });
      await expect(newEpisodes).toHaveAttribute('aria-checked', 'true');

      await newEpisodes.click();
      await page.getByRole('button', { name: 'Save preferences' }).click();

      await expect(page.getByText('Your preferences were saved.')).toBeVisible();

      // The save really reached the database.
      await page.reload();
      await expect(page.getByRole('switch', { name: 'New episodes' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
    } finally {
      await removeNotifications(session.userId);
      await adminSession.remove(session.userId);
    }
  });

  test('offers no switch for the mandatory account notifications', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-notification-mandatory@example.com',
      superAdmin: false,
    });

    try {
      await signIn(context, session);
      await page.goto('/settings/notifications');

      await expect(page.getByText('Always on. Security notifications cannot be switched off.')).toBeVisible();
      await expect(page.getByText('Mandatory')).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Account & security' })).toHaveCount(0);
    } finally {
      await removeNotifications(session.userId);
      await adminSession.remove(session.userId);
    }
  });
});
