import { expect, test, type BrowserContext } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';

/**
 * Browser coverage for the `/admin/notifications` announcement administration
 * (Prompt 153).
 *
 * The session is seeded through the test-only helper, so the application's real
 * session lookup, permission guard, and announcement writes run. What is
 * asserted is what a browser actually receives: a draft that publishes nothing
 * until the administrator publishes it, the published state afterwards, and the
 * 404 an unauthorized session gets.
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
