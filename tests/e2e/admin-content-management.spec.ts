import { expect, test } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import { removeDramaBySlug, removeTaxonomyBySlug } from './support/drama-fixture.mjs';
import { taxonomySlugFromName } from '../../src/lib/contracts/taxonomy-form';
import { dramaSlugFromTitle } from '../../src/lib/contracts/drama-form';

/**
 * End-to-end browser coverage for admin content management (categories, platforms,
 * seasons, and episodes).
 *
 * All operations run against the real database through Better Auth sessions
 * and Server Actions. Nothing is mocked.
 */
test.describe('admin content management', () => {
  test('manages categories, platforms, seasons, and episodes end-to-end', async ({
    context,
    page,
  }) => {
    const session = await adminSession.seed({ email: 'e2e-content-admin@example.com' });
    const suffix = Date.now().toString(36);
    const categoryName = `E2E Category ${suffix}`;
    const categorySlug = taxonomySlugFromName(categoryName);
    const platformName = `E2E Platform ${suffix}`;
    const platformSlug = taxonomySlugFromName(platformName);
    const dramaTitle = `E2E Managed Drama ${suffix}`;
    const dramaSlug = dramaSlugFromTitle(dramaTitle);

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

      // 1. Create and manage categories
      await page.goto('/admin/categories');
      await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();

      await page.getByLabel(/^Name/).fill(categoryName);
      await page.getByRole('button', { name: 'Add category' }).click();

      await expect(page.getByRole('cell', { name: categoryName, exact: true })).toBeVisible();

      // 2. Create and manage platforms
      await page.goto('/admin/platforms');
      await expect(page.getByRole('heading', { name: 'Platforms' })).toBeVisible();

      await page.getByLabel(/^Name/).fill(platformName);
      await page.getByRole('button', { name: 'Add platform' }).click();

      await expect(page.getByRole('cell', { name: platformName, exact: true })).toBeVisible();

      // 3. Create a season-based drama selecting the category and platform
      await page.goto('/admin/dramas/new');
      await expect(page.getByRole('heading', { name: 'Add drama' })).toBeVisible();

      await page.getByLabel(/^Title/).fill(dramaTitle);
      await page.getByLabel(/^Status/).selectOption('ongoing');
      await page.getByLabel(/^Episode structure/).selectOption('season_based');
      await page.getByLabel(categoryName).check();
      await page.getByLabel(platformName).check();
      await page.getByRole('button', { name: 'Create drama' }).click();

      await expect(page).toHaveURL(/\/admin\/dramas$/);

      // 4. Open the drama detail page and manage seasons / episodes
      const dramaId = await page.evaluate(async (title) => {
        // Find the edit link or fetch via DOM
        const rows = Array.from(document.querySelectorAll('tr'));
        for (const row of rows) {
          if (row.textContent?.includes(title)) {
            const link = row.querySelector('a[href*="/admin/dramas/"]');
            if (link) return link.getAttribute('href');
          }
        }
        return null;
      }, dramaTitle);

      if (dramaId) {
        await page.goto(dramaId);
      } else {
        await page.goto('/admin/dramas');
        const row = page.getByRole('row', { name: new RegExp(dramaTitle) });
        await expect(row).toBeVisible();
        await row.getByRole('link', { name: dramaTitle }).click({ force: true });
      }

      await expect(page).toHaveURL(new RegExp(`/admin/dramas/[0-9a-f-]+$`));
      await expect(page.getByRole('heading', { name: dramaTitle })).toBeVisible();

      // Add a season
      await page.getByRole('region', { name: 'New Season' }).getByLabel(/^Title/).fill('Season 1');
      const addSeasonBtn = page.getByRole('button', { name: 'Add season' });
      await expect(addSeasonBtn).toBeEnabled();
      await addSeasonBtn.click();
      await expect(page.getByRole('cell', { name: 'Season 1', exact: true })).toBeVisible();

      // Add an episode linked to Season 1
      await page.getByRole('region', { name: 'New Episode' }).getByLabel(/^Title/).fill('Episode 1');
      await page.getByRole('region', { name: 'New Episode' }).getByLabel(/Video Source/).fill('https://media.example.com/e2e/ep1.mp4');
      await page.getByRole('button', { name: 'Add episode' }).click();

      await expect(page.getByRole('cell', { name: 'Episode 1', exact: true })).toBeVisible();
    } finally {
      // Clean up created entities
      await removeDramaBySlug(dramaSlug).catch(() => {});
      await removeTaxonomyBySlug('category', categorySlug).catch(() => {});
      await removeTaxonomyBySlug('platform', platformSlug).catch(() => {});
      await adminSession.remove(session.userId);
    }
  });
});
