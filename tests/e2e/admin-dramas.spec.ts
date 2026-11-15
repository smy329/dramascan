import { expect, test, type BrowserContext } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import { removeDrama, seedDrama } from './support/drama-fixture.mjs';

/**
 * Browser coverage for the drama structure conversion surface.
 *
 * The session is seeded through the test-only helper and the drama rows are
 * written to the isolated test database, so the application performs its real
 * session lookup, permission guard, preview, and transactional apply. Nothing
 * is mocked.
 */

test.describe('admin drama conversion', () => {
  test('lists dramas and links to the conversion page', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-dramas-list@example.com' });
    const drama = await seedDrama({ title: 'E2E Listed Drama' });

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

      await expect(page.getByRole('heading', { name: 'Dramas' })).toBeVisible();
      await expect(page.getByRole('cell', { name: drama.title })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Season-based' })).toBeVisible();

      await page
        .getByRole('row', { name: new RegExp(drama.title) })
        .getByRole('link', { name: 'Convert structure' })
        .click();

      await expect(page).toHaveURL(new RegExp(`/admin/dramas/${drama.id}/convert`));
      await expect(page.getByRole('heading', { name: /Convert/ })).toBeVisible();
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session.userId);
    }
  });

  test('previews and applies a season-based to flat conversion', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-dramas-convert@example.com' });
    const drama = await seedDrama({
      title: 'E2E Converted Drama',
      structureType: 'season_based',
      seasonCount: 2,
      episodesPerSeason: 2,
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

      await page.goto(`/admin/dramas/${drama.id}/convert`);

      await expect(page.getByText(/Current structure: Season-based/)).toBeVisible();

      await page.getByRole('button', { name: 'Preview conversion' }).click();

      await expect(page.getByRole('cell', { name: 'Episode 1.1' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Episode 2.2' })).toBeVisible();

      await page.getByRole('button', { name: 'Confirm conversion' }).click();

      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Convert' }).click();

      await expect(page.getByText('Conversion applied.')).toBeVisible();

      // The listing now reports the new structure and the episode count.
      await page.goto('/admin/dramas');
      await expect(
        page.getByRole('row', { name: new RegExp(drama.title) }).getByRole('cell', { name: 'Flat' })
      ).toBeVisible();
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session.userId);
    }
  });

  test('restores the previous structure from the available snapshot', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-dramas-restore@example.com' });
    const drama = await seedDrama({
      title: 'E2E Restored Drama',
      structureType: 'season_based',
      seasonCount: 1,
      episodesPerSeason: 2,
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

      await page.goto(`/admin/dramas/${drama.id}/convert`);

      await page.getByRole('button', { name: 'Preview conversion' }).click();
      await expect(page.getByRole('cell', { name: 'Episode 1.1' })).toBeVisible();

      await page.getByRole('button', { name: 'Confirm conversion' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Convert' }).click();
      await expect(page.getByText('Conversion applied.')).toBeVisible();

      // The drama is flat now and an available snapshot exists, so the page
      // offers the explicit strategy choice. No option is preselected.
      await page.reload();
      await expect(page.getByText(/Current structure: Flat/)).toBeVisible();
      await expect(page.getByLabel(/Restore previous structure/)).not.toBeChecked();
      await expect(page.getByLabel(/Create new seasons/)).not.toBeChecked();
      await expect(page.getByRole('button', { name: 'Preview conversion' })).toBeDisabled();

      await page.getByLabel(/Restore previous structure/).check();

      await page.getByRole('button', { name: 'Preview conversion' }).click();
      await expect(page.getByRole('cell', { name: 'Episode 1.1' })).toBeVisible();

      await page.getByRole('button', { name: 'Confirm conversion' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Convert' }).click();
      await expect(page.getByText('Conversion applied.')).toBeVisible();

      await page.goto('/admin/dramas');
      await expect(
        page
          .getByRole('row', { name: new RegExp(drama.title) })
          .getByRole('cell', { name: 'Season-based' })
      ).toBeVisible();
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session.userId);
    }
  });

  test('refuses a signed-in account without drama.manage', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-dramas-forbidden@example.com',
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

      const response = await page.goto('/admin/dramas');

      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: 'Dramas' })).toHaveCount(0);
    } finally {
      await adminSession.remove(session.userId);
    }
  });
});

test.describe('admin drama → movie conversion', () => {
  async function signIn(context: BrowserContext, email: string) {
    const session = await adminSession.seed({ email });
    await context.addCookies([
      {
        name: session.cookieName,
        value: session.cookieValue,
        url: 'http://localhost:3000',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    return session;
  }

  test('offers the movie conversion only for a single-episode drama', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-movie-conv-list@example.com');
    const eligible = await seedDrama({
      title: 'E2E Single Episode Drama',
      structureType: 'flat',
      seasonCount: 1,
      episodesPerSeason: 1,
    });
    const ineligible = await seedDrama({
      title: 'E2E Multi Episode Drama',
      structureType: 'flat',
      seasonCount: 1,
      episodesPerSeason: 2,
    });

    try {
      await page.goto('/admin/dramas?search=E2E%20Single%20Episode%20Drama');
      await expect(
        page
          .getByRole('row', { name: new RegExp(eligible.title) })
          .getByRole('link', { name: 'Convert to movie' })
      ).toBeVisible();

      await page.goto('/admin/dramas?search=E2E%20Multi%20Episode%20Drama');
      await expect(
        page.getByRole('row', { name: new RegExp(ineligible.title) })
      ).toBeVisible();
      await expect(
        page
          .getByRole('row', { name: new RegExp(ineligible.title) })
          .getByRole('link', { name: 'Convert to movie' })
      ).toHaveCount(0);
    } finally {
      await removeDrama(ineligible);
      await removeDrama(eligible);
      await adminSession.remove(session.userId);
    }
  });

  test('previews the resulting movie and applies the conversion', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-movie-conv-apply@example.com');
    const drama = await seedDrama({
      title: 'E2E Converted To Movie',
      structureType: 'flat',
      seasonCount: 1,
      episodesPerSeason: 1,
      episodeVideoSource: 'https://media.example.com/e2e/only-episode.mp4',
    });

    try {
      // Warm the route so a cold Turbopack compile cannot race the client-side
      // transition; the link click below is what the test verifies.
      await page.request.get(`/admin/dramas/${drama.id}/convert-to-movie`);

      await page.goto('/admin/dramas?search=E2E%20Converted%20To%20Movie');
      await page
        .getByRole('row', { name: new RegExp(drama.title) })
        .getByRole('link', { name: 'Convert to movie' })
        .click();

      await expect(page).toHaveURL(new RegExp(`/admin/dramas/${drama.id}/convert-to-movie`));
      await expect(page.getByRole('heading', { name: /Convert .* to a movie/ })).toBeVisible();
      await expect(page.getByText(/currently has 1 active episode\./)).toBeVisible();

      await page.getByRole('button', { name: 'Preview conversion' }).click();

      await expect(page.getByText(drama.slug)).toBeVisible();
      await expect(page.getByText('https://media.example.com/e2e/only-episode.mp4')).toBeVisible();
      await expect(page.getByText('Ratings: None')).toBeVisible();

      await page.getByRole('button', { name: 'Convert to movie' }).click();

      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('The movie keeps the drama');
      await dialog.getByRole('button', { name: 'Convert to movie' }).click();

      await expect(
        page.getByText(`“${drama.title}” was created as a standalone movie.`)
      ).toBeVisible();

      // The drama moved to Trash, so the active list no longer offers it.
      await page.goto('/admin/dramas?search=E2E%20Converted%20To%20Movie');
      await expect(page.getByRole('cell', { name: drama.title })).toHaveCount(0);
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session.userId);
    }
  });

  test('explains why a multi-episode drama cannot be converted', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-movie-conv-ineligible@example.com');
    const drama = await seedDrama({
      title: 'E2E Ineligible Movie Drama',
      structureType: 'flat',
      seasonCount: 1,
      episodesPerSeason: 2,
    });

    try {
      await page.goto(`/admin/dramas/${drama.id}/convert-to-movie`);

      await expect(page.getByRole('alert')).toContainText('2 active episodes');
      await expect(page.getByRole('button', { name: 'Preview conversion' })).toHaveCount(0);
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session.userId);
    }
  });
});
