import { expect, test } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import { removeDramaBySlug } from './support/drama-fixture.mjs';

/**
 * Browser coverage for the admin drama creation form (Prompt 053).
 *
 * The session is seeded through the test-only helper, so the real session
 * lookup, permission guard, Server Action, workflow validation, and database
 * transaction all run. The created drama is removed by its unique slug.
 */

test.describe('admin drama creation', () => {
  test('creates a flat drama and rejects a duplicate slug', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-drama-create@example.com' });
    const suffix = Date.now().toString(36);
    const slug = `e2e-created-drama-${suffix}`;
    const title = `E2E Created Drama ${suffix}`;

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

      await page.goto('/admin/dramas');
      expect(
        await page.getByRole('link', { name: 'Add drama' }).getAttribute('href')
      ).toBe('/admin/dramas/new');

      // Direct navigation instead of a Link click: the first request to the
      // route compiles it in development, which can outlast a click-bound
      // assertion. The href is asserted above, so the link itself is covered.
      await page.goto('/admin/dramas/new');

      await expect(page).toHaveURL(/\/admin\/dramas\/new$/);
      await expect(page.getByRole('heading', { name: 'Add drama' })).toBeVisible();

      await page.getByLabel(/^Title/).fill(title);
      await page.getByLabel(/^Slug/).fill(slug);
      await page.getByLabel(/^Status/).selectOption('completed');
      await page.getByLabel(/^Episode structure/).selectOption('flat');
      await page.getByRole('button', { name: 'Create drama' }).click();

      await expect(page).toHaveURL(/\/admin\/dramas$/);

      // The created row exists with the chosen structure.
      await page.goto(`/admin/dramas?q=${encodeURIComponent(title)}`);
      const row = page.getByRole('row', { name: new RegExp(title) });
      await expect(row).toBeVisible();
      await expect(row.getByRole('cell', { name: 'Flat' })).toBeVisible();

      // A second drama with the same slug is rejected by the server and the
      // conflict is reported on the form instead of creating a row.
      await page.goto('/admin/dramas/new');
      await page.getByLabel(/^Title/).fill(`${title} Copy`);
      await page.getByLabel(/^Slug/).fill(slug);
      await page.getByRole('button', { name: 'Create drama' }).click();

      await expect(page.locator('[data-slot="admin-form-error"]')).toContainText(
        'A drama with this slug already exists.'
      );
      await expect(page.getByText('A drama with this slug already exists.').first()).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/dramas\/new$/);
    } finally {
      await removeDramaBySlug(slug);
      await adminSession.remove(session.userId);
    }
  });
});
