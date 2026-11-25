import { expect, test, type BrowserContext } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import {
  removeAdminNotification,
  seedAdminNotification,
} from './support/admin-notification-fixture.mjs';

/**
 * Browser coverage for the `/admin/notifications` centre (Prompts 153 / D-067).
 *
 * The session is seeded through the test-only helper, so the application's real
 * session lookup, permission guard, audience filter, and read-state writes run.
 * What is asserted is what a browser actually receives: the alerts an
 * administrator may see, the per-administrator read state across a reload, the
 * detail page, the announcement administration, and the 404 an unauthorized
 * session gets.
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

test.describe('admin alerts', () => {
  test('lists an alert, keeps the read state across a reload, and opens its detail', async ({
    context,
    page,
  }) => {
    const session = await adminSession.seed({ email: 'e2e-admin-alert@example.com' });
    const title = `E2E alert ${Date.now()}`;
    const content = 'A content report is waiting for a moderator.';
    const alert = await seedAdminNotification({
      title,
      content,
      audience: 'all',
      category: 'content',
      priority: 'high',
    });

    try {
      await signIn(context, session);
      await page.goto('/admin/notifications');

      await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();

      const article = page.getByRole('article').filter({ hasText: title });
      await expect(article).toBeVisible();
      await expect(article.getByLabel('Unread')).toBeVisible();
      await expect(article.getByText('High', { exact: true })).toBeVisible();

      await article.getByRole('button', { name: 'Mark read' }).click();
      await expect(article.getByRole('button', { name: 'Mark unread' })).toBeVisible();

      // The read state is stored per administrator, so a reload still shows it.
      await page.reload();
      const reloaded = page.getByRole('article').filter({ hasText: title });
      await expect(reloaded.getByRole('button', { name: 'Mark unread' })).toBeVisible();

      await reloaded.getByRole('link', { name: title }).click();

      // The detail route is a separate page; the timeout is generous because a
      // development server may still be compiling it.
      await expect(page).toHaveURL(/\/admin\/notifications\/[0-9a-f-]+$/, { timeout: 60_000 });
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      await expect(page.getByText(content, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mark unread' })).toBeVisible();
    } finally {
      await removeAdminNotification(alert.id);
      await adminSession.remove(session.userId);
    }
  });
});

test.describe('admin announcements', () => {
  test('creates a draft and publishes it by hand', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-announcement-admin@example.com' });
    const title = `E2E announcement ${Date.now()}`;

    try {
      await signIn(context, session);
      await page.goto('/admin/notifications');

      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();

      await page.getByLabel('Title').fill(title);
      await page
        .getByLabel('Message')
        .fill('The notification centre is now available to every viewer.');
      await page.getByRole('button', { name: 'Create draft' }).click();

      await expect(
        page.getByText('The announcement was created as a draft.', { exact: true })
      ).toBeVisible();

      // The list holds the announcement the test just wrote.
      const card = page.getByRole('article', { name: title });
      await expect(card.getByRole('heading', { name: title })).toBeVisible();

      // The draft publishes nothing until it is published.
      await expect(card.getByText('Draft')).toBeVisible();

      await page.getByRole('button', { name: `Publish ${title}` }).click();

      await expect(
        page.getByText('The announcement was published.', { exact: true })
      ).toBeVisible();
      await expect(card.getByText('Published')).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('refuses a viewer without the settings permission', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-announcement-forbidden@example.com',
      superAdmin: false,
    });

    try {
      await signIn(context, session);
      const response = await page.goto('/admin/notifications');

      expect(response?.status()).toBe(404);
    } finally {
      await adminSession.remove(session.userId);
    }
  });
});
