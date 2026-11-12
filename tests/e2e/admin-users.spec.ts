import { expect, test } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';

/**
 * Browser coverage for the `/admin/users` listing.
 *
 * The session is seeded through the test-only helper, so the application
 * performs its real session lookup, account-status gate, actor resolution, and
 * `user.read` permission check — nothing is mocked. What is asserted is what a
 * browser actually receives: the rendered table, the URL state the sort, search,
 * filter, and pagination controls produce, the 404 an unauthorized session
 * gets, and the absence of horizontal overflow at every viewport.
 */

test.describe('admin users listing', () => {
  test('lists, searches, filters, sorts, and paginates', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-users-list@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      await page.goto('/admin/users');

      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();

      // Sorting is a link that keeps the rest of the table state.
      await page.getByRole('columnheader', { name: /Name/ }).getByRole('link').click();
      await expect(page).toHaveURL(/sort=-name/);

      // The status filter is a GET form that resets to the first page.
      await page.getByLabel('Status').selectOption('active');
      await page.getByRole('button', { name: 'Apply' }).first().click();
      await expect(page).toHaveURL(/status=active/);
      await expect(page).not.toHaveURL(/page=\d/);

      // The search term survives the filter.
      await page.getByLabel('Search users').fill('e2e');
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page).toHaveURL(/q=e2e/);
      await expect(page).toHaveURL(/status=active/);
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('shows the empty state when nothing matches', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-users-empty@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      await page.goto('/admin/users?q=definitely-not-a-real-account-name');

      await expect(page.getByText(/No accounts match/)).toBeVisible();
      await expect(page.getByRole('link', { name: /clear/i })).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('normalizes an invalid query instead of failing', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-users-invalid@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      const response = await page.goto(
        '/admin/users?page=-3&pageSize=9999&sort=password&status=bogus'
      );

      expect(response?.status()).toBe(200);
      await expect(page.getByRole('table')).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('never scrolls the page horizontally at any viewport', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-users-responsive@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      for (const viewport of [
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto('/admin/users');

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );

        expect(overflow).toBeLessThanOrEqual(0);
      }
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('refuses a signed-in account without admin access', async ({ context, page }) => {
    // A real, active, non-Super-Admin account with no role assignments. The
    // admin shell answers 404 rather than 403, so the area stays hidden, and
    // the page's own `user.read` check is a second guard behind it.
    const session = await adminSession.seed({
      email: 'e2e-users-forbidden@example.com',
      name: 'E2E Ordinary User',
      superAdmin: false,
    });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      const response = await page.goto('/admin/users');

      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: 'Users' })).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);
    } finally {
      await adminSession.remove(session.userId);
    }
  });
});
