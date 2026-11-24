import { expect, test, type BrowserContext } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';

/**
 * Browser coverage for the `/admin/analytics` dashboard (Prompts 144, 145, 146).
 *
 * The session is seeded through the test-only helper, so the application's real
 * session lookup, permission guard, and dashboard read models run. What is
 * asserted is what a browser actually receives: the overview metrics, the date
 * filters, the manual refresh, the "last updated" line, and the 404 an
 * unauthorized session gets.
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

test.describe('admin analytics dashboard', () => {
  test('shows the overview, the date filters, and the last-updated line', async ({
    context,
    page,
  }) => {
    const session = await adminSession.seed({ email: 'e2e-analytics-dashboard@example.com' });

    try {
      await signIn(context, session);
      await page.goto('/admin/analytics');

      await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();

      // The overview metrics.
      await expect(page.getByText('Total views', { exact: true })).toBeVisible();
      await expect(page.getByText('Unique viewers', { exact: true })).toBeVisible();
      await expect(page.getByText('Watch time', { exact: true })).toBeVisible();
      await expect(page.getByText('Completion rate', { exact: true })).toBeVisible();

      // The approved date filters.
      for (const label of [
        'Today',
        'Yesterday',
        'Last 7 Days',
        'Last 30 Days',
        'Last 90 Days',
        'This Month',
        'Last Month',
      ]) {
        await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
      }

      // The three report sections.
      await expect(page.getByRole('heading', { name: 'Content performance' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Viewer activity' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Engagement trend' })).toBeVisible();

      // The dashboard says when the numbers were last written.
      await expect(page.getByText('Last updated', { exact: true })).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('aggregates the selected range when the administrator refreshes', async ({
    context,
    page,
  }) => {
    const session = await adminSession.seed({ email: 'e2e-analytics-refresh@example.com' });

    try {
      await signIn(context, session);
      await page.goto('/admin/analytics');

      await page.getByRole('button', { name: 'Refresh data' }).click();

      await expect(page.getByText('The analytics were refreshed.', { exact: true })).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('keeps the selected range in the URL', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-analytics-range@example.com' });

    try {
      await signIn(context, session);
      await page.goto('/admin/analytics');

      await page.getByRole('link', { name: 'Last 7 Days', exact: true }).click();

      await expect(page).toHaveURL(/range=last_7_days/);
      await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('refuses a viewer without the analytics permission', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-analytics-forbidden@example.com',
      superAdmin: false,
    });

    try {
      await signIn(context, session);
      const response = await page.goto('/admin/analytics');

      expect(response?.status()).toBe(404);
    } finally {
      await adminSession.remove(session.userId);
    }
  });
});
