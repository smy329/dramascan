import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import { removeDrama, seedDrama } from './support/drama-fixture.mjs';

/**
 * Browser coverage for similar-drama administration.
 *
 * The seeded Super Admin session and the seeded drama rows live in the
 * isolated test database, so the real session lookup, permission guard,
 * candidate search, transactional mutations, and reorder endpoint all run.
 * Nothing is mocked.
 */

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

async function rowTitles(page: Page): Promise<string[]> {
  return page.locator('table tbody tr td:nth-child(2)').allTextContents();
}

test.describe('admin similar dramas', () => {
  test('adds, reorders, and removes recommendations with persisted order', async ({
    context,
    page,
  }) => {
    // This flow adds two recommendations, reorders them, reloads the page, and
    // removes one of them again. Every step is a real REST call against the
    // real database, and the admin routes are compiled by the development
    // server on their first request. The suite's global 30-second budget is
    // smaller than the configured 45-second navigation timeout, so a cold
    // route compile plus the real work does not fit in it. The budget is
    // raised here; no assertion is weakened.
    test.setTimeout(120_000);

    const session = await signIn(context, 'e2e-similar-manage@example.com');
    const parent = await seedDrama({ title: 'E2E Similar Parent', withEpisodes: false });
    const alpha = await seedDrama({ title: 'E2E Similar Alpha', withEpisodes: false });
    const beta = await seedDrama({ title: 'E2E Similar Beta', withEpisodes: false });

    try {
      // Warm the routes so a cold Turbopack compile cannot race the click.
      await page.request.get('/admin/dramas', { timeout: 60_000 });
      await page.request.get(`/admin/dramas/${parent.id}/similar-dramas`, { timeout: 60_000 });
      await page.request.get(`/admin/api/similar-dramas/candidates?dramaId=${parent.id}&search=a`, {
        timeout: 60_000,
      });

      // The drill-down is reached from a concrete drama row, never a sidebar
      // entry with an unresolved `[id]` token.
      await page.goto('/admin/dramas?search=E2E%20Similar%20Parent');
      await page
        .getByRole('row', { name: new RegExp(parent.title) })
        .getByRole('link', { name: 'Manage similar dramas' })
        .click();

      await expect(page).toHaveURL(new RegExp(`/admin/dramas/${parent.id}/similar-dramas`));
      await expect(
        page.getByRole('heading', { level: 1, name: `Similar dramas for ${parent.title}` })
      ).toBeVisible();
      await expect(page.getByText('No similar dramas yet')).toBeVisible();

      const addSection = page.getByRole('region', { name: 'Add a similar drama' });
      const search = addSection.getByLabel('Search dramas by title');
      const searchButton = addSection.getByRole('button', { name: 'Search' });

      async function addCandidate(fixture: { id: string; title: string }, term: string) {
        await search.fill(term);
        await searchButton.click();

        const added = page.waitForResponse(
          response =>
            response.url().endsWith('/admin/api/similar-dramas') &&
            response.request().method() === 'POST'
        );

        await page
          .getByRole('listitem')
          .filter({ hasText: fixture.title })
          .getByRole('button', { name: 'Add' })
          .click();

        expect((await added).status()).toBe(201);
        await expect(page.getByRole('cell', { name: fixture.title, exact: true })).toBeVisible();
      }

      await addCandidate(alpha, 'E2E Similar Alpha');
      await addCandidate(beta, 'E2E Similar Beta');

      expect(await rowTitles(page)).toEqual([alpha.title, beta.title]);

      // Reorder through the API-backed control, then prove the new order is
      // stored rather than only rendered. Waiting for the mutation response
      // prevents a reload from aborting the request mid-flight.
      const reordered = page.waitForResponse(
        response =>
          response.url().includes('/admin/api/similar-dramas/reorder') &&
          response.request().method() === 'PUT'
      );
      await page.getByRole('button', { name: `Move ${beta.title} up` }).click();
      expect((await reordered).status()).toBe(200);

      await expect
        .poll(async () => rowTitles(page), { message: 'reordered rows' })
        .toEqual([beta.title, alpha.title]);

      await page.reload();
      expect(await rowTitles(page)).toEqual([beta.title, alpha.title]);

      // A duplicate is rejected by the service, not only by the UI: the
      // candidate search excludes targets that are already associated.
      await search.fill('E2E Similar Alpha');
      await searchButton.click();
      await expect(page.getByText('No matching dramas to add.')).toBeVisible();

      const removed = page.waitForResponse(
        response =>
          response.url().endsWith('/admin/api/similar-dramas') &&
          response.request().method() === 'DELETE'
      );
      const alphaRow = page.getByRole('row', { name: new RegExp(alpha.title) });
      await alphaRow.getByRole('button', { name: 'Remove' }).click();
      expect((await removed).status()).toBe(204);
      await expect(page.getByRole('cell', { name: alpha.title, exact: true })).toHaveCount(0);

      await page.reload();
      expect(await rowTitles(page)).toEqual([beta.title]);
    } finally {
      await removeDrama(beta);
      await removeDrama(alpha);
      await removeDrama(parent);
      await adminSession.remove(session.userId);
    }
  });

  test('returns not-found for an unknown drama id', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-similar-notfound@example.com');

    try {
      // `notFound()` is raised after the streamed shell, so the browser sees the
      // not-found document rather than an HTTP 404 status. The rendered
      // not-found UI is what a user experiences.
      await page.goto('/admin/dramas/3fbc8b1a-3b0e-4f43-a7fd-c22f2d6c4e4f/similar-dramas');

      await expect(
        page.getByRole('heading', { name: 'This page could not be found.' })
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: /Similar dramas for/ })).toHaveCount(0);
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('refuses an account without the drill-down permission', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-similar-forbidden@example.com',
      name: 'E2E Ordinary User',
      superAdmin: false,
    });
    const parent = await seedDrama({ title: 'E2E Similar Guarded', withEpisodes: false });

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

      const response = await page.goto(`/admin/dramas/${parent.id}/similar-dramas`);

      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: /Similar dramas for/ })).toHaveCount(0);
    } finally {
      await removeDrama(parent);
      await adminSession.remove(session.userId);
    }
  });
});
