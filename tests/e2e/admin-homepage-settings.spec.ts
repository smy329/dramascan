import { expect, test, type BrowserContext } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import { removeDrama, seedDrama } from './support/drama-fixture.mjs';
import {
  deleteAuditEventsForActor,
  restoreHomepageSettings,
  snapshotHomepageSettings,
} from './support/system-settings.mjs';

/**
 * Browser coverage for the homepage settings.
 *
 * The homepage reads three settings: the featured item, the hero rotation, and
 * the Trending pins. The administrator changes them on three admin pages, and
 * each change goes through a Server Action that re-checks the permission and
 * the availability of every referenced item.
 *
 * The rows are written to the isolated test database, so the real pages, the
 * real Server Actions, and the real settings table are exercised. Nothing is
 * mocked. The setting rows are shared by the whole test database, so every test
 * snapshots them first and puts them back afterwards.
 */

const VIDEO_SOURCE = 'https://media.example.com/episodes/e2e-homepage.mp4';

/** Escape a title so it can be used inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sign a browser context in as a seeded user. */
async function signIn(
  context: BrowserContext,
  email: string,
  options: { superAdmin?: boolean } = {}
): Promise<Awaited<ReturnType<typeof adminSession.seed>>> {
  const session = await adminSession.seed({ email, superAdmin: options.superAdmin ?? false });

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

/**
 * A published drama the administrator may feature.
 *
 * The publication date is stamped so the drama is the newest hero candidate;
 * the candidate list is ordered by publication time and is capped.
 */
async function seedPublishedDrama(title: string) {
  return seedDrama({
    title,
    publicationStatus: 'published',
    publishedAt: new Date(),
    seasonPublicationStatus: 'published',
    episodePublicationStatus: 'published',
    episodeVideoSource: VIDEO_SOURCE,
  });
}

test.describe('the homepage settings', () => {
  test('the featured item is saved and can be cleared', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-homepage-featured@example.com', {
      superAdmin: true,
    });
    const drama = await seedPublishedDrama('E2E Homepage Featured Drama');
    const settings = await snapshotHomepageSettings();

    try {
      await page.goto('/admin/featured');

      await expect(page.getByRole('heading', { name: 'Homepage hero' })).toBeVisible();

      const candidate = page.getByRole('listitem').filter({ hasText: drama.title });

      await expect(candidate).toBeVisible();

      await candidate.getByRole('button', { name: 'Feature', exact: true }).click();

      await expect(page.getByRole('status')).toHaveText(
        `${drama.title} is now the featured item.`
      );

      // The selection survives a reload: it is stored in the settings table,
      // not held in client state.
      await page.reload();

      const reloaded = page.getByRole('listitem').filter({ hasText: drama.title });

      await expect(reloaded.getByRole('button', { name: 'Featured', exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Clear the featured item' }).click();

      await expect(page.getByRole('status')).toHaveText(
        'The featured item was cleared. The homepage uses its automatic fallback.'
      );
    } finally {
      await restoreHomepageSettings(settings);
      await deleteAuditEventsForActor(session.userId);
      await removeDrama(drama);
      await adminSession.remove(session);
    }
  });

  test('the hero rotation is turned on with a selected item', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-homepage-rotation@example.com', {
      superAdmin: true,
    });
    const drama = await seedPublishedDrama('E2E Homepage Rotation Drama');
    const settings = await snapshotHomepageSettings();

    try {
      await page.goto('/admin/hero-rotation');

      await expect(page.getByRole('heading', { name: 'Hero rotation' })).toBeVisible();

      await page.getByRole('checkbox', { name: 'Rotate the homepage hero' }).check();
      await page
        .getByRole('checkbox', { name: new RegExp(escapeRegExp(drama.title)) })
        .check();

      await page.getByRole('button', { name: 'Save rotation settings' }).click();

      await expect(page.getByRole('status')).toHaveText('Hero rotation is on with 1 item.');

      await page.reload();

      await expect(page.getByRole('checkbox', { name: 'Rotate the homepage hero' })).toBeChecked();
      await expect(
        page.getByRole('checkbox', { name: new RegExp(escapeRegExp(drama.title)) })
      ).toBeChecked();
    } finally {
      await restoreHomepageSettings(settings);
      await deleteAuditEventsForActor(session.userId);
      await removeDrama(drama);
      await adminSession.remove(session);
    }
  });

  test('a title is pinned into Trending', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-homepage-pins@example.com', {
      superAdmin: true,
    });
    const drama = await seedPublishedDrama('E2E Homepage Pinned Drama');
    const settings = await snapshotHomepageSettings();

    try {
      await page.goto('/admin/trending-pins');

      await expect(page.getByRole('heading', { name: 'Trending pins' })).toBeVisible();

      await page
        .getByRole('checkbox', { name: new RegExp(escapeRegExp(drama.title)) })
        .check();

      await page.getByRole('button', { name: 'Save pins' }).click();

      await expect(page.getByRole('status')).toHaveText('1 item is pinned into Trending.');

      await page.reload();

      await expect(
        page.getByRole('checkbox', { name: new RegExp(escapeRegExp(drama.title)) })
      ).toBeChecked();
    } finally {
      await restoreHomepageSettings(settings);
      await deleteAuditEventsForActor(session.userId);
      await removeDrama(drama);
      await adminSession.remove(session);
    }
  });

  test('a signed-in viewer cannot open the homepage settings', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-homepage-viewer@example.com', {
      superAdmin: false,
    });

    try {
      // The page guard hides the administration area from an actor without the
      // permission, so the answer is a 404 rather than a forbidden page.
      const response = await page.goto('/admin/featured');

      expect(response?.status()).toBe(404);
    } finally {
      await adminSession.remove(session);
    }
  });
});
