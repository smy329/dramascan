import { expect, test } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import { removeDramaBySlug } from './support/drama-fixture.mjs';
import { dramaSlugFromTitle } from '../../src/lib/contracts/drama-form';

/**
 * Browser coverage for the admin drama creation form (Prompt 053).
 *
 * The session is seeded through the test-only helper, so the real session
 * lookup, permission guard, Server Action, workflow validation, and database
 * transaction all run. The created drama is removed by the slug derived from
 * its unique title.
 */

test.describe('admin drama creation', () => {
  test('creates a flat drama from the title and rejects a duplicate title', async ({
    context,
    page,
  }) => {
    // The admin routes are compiled by the development server on their first
    // request, and a cold compile on a network drive can outlast the suite's
    // 30-second budget. The routes are warmed before the flow and the budget
    // is raised here; no assertion is weakened.
    test.setTimeout(120_000);

    const session = await adminSession.seed({ email: 'e2e-drama-create@example.com' });
    const suffix = Date.now().toString(36);
    const title = `E2E Created Drama ${suffix}`;
    const slug = dramaSlugFromTitle(title);

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

      // Warm the two admin routes this flow visits, so a cold Turbopack
      // compile cannot eat the test's budget.
      await page.request.get('/admin/dramas', { timeout: 60_000 });
      await page.request.get('/admin/dramas/new', { timeout: 60_000 });

      await page.goto('/admin/dramas');
      expect(await page.getByRole('link', { name: 'Add drama' }).getAttribute('href')).toBe(
        '/admin/dramas/new'
      );

      // Direct navigation instead of a Link click: the first request to the
      // route compiles it in development, which can outlast a click-bound
      // assertion. The href is asserted above, so the link itself is covered.
      await page.goto('/admin/dramas/new');

      await expect(page).toHaveURL(/\/admin\/dramas\/new$/);
      await expect(page.getByRole('heading', { name: 'Add drama' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: /slug/i })).toHaveCount(0);

      await page.getByLabel(/^Title/).fill(title);
      await page.getByLabel(/^Status/).selectOption('completed');
      await page.getByLabel(/^Episode structure/).selectOption('flat');
      await page.getByRole('button', { name: 'Create drama' }).click();

      await expect(page).toHaveURL(/\/admin\/dramas$/);

      // The created row exists with the chosen structure.
      await page.goto(`/admin/dramas?q=${encodeURIComponent(title)}`);
      const row = page.getByRole('row', { name: new RegExp(title) });
      await expect(row).toBeVisible();
      await expect(row.getByRole('cell', { name: 'Flat' })).toBeVisible();

      // The same title derives the same slug, so the server rejects the second
      // drama and reports the conflict on the Title field.
      await page.goto('/admin/dramas/new');
      await page.getByLabel(/^Title/).fill(title);
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
