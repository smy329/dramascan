import { expect, test } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';

test.describe('seeded admin session', () => {
  test('signs a Super Admin into the admin area', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-superadmin@example.com' });

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

      await page.goto('/admin');

      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });
});
