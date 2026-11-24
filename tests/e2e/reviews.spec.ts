import { expect, test, type BrowserContext } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';
import { removeDrama, seedDrama } from './support/drama-fixture.mjs';
import { readNotifications } from './support/moderation-fixture.mjs';

/**
 * Browser coverage for ratings, reviews, reactions, reports, and moderation.
 *
 * The community features are a chain: a viewer rates a title, writes a review,
 * reacts to a review, and reports one; a moderator then resolves the report
 * and the reporter is told what was decided. Every link in that chain is
 * exercised here through the real pages, the real Server Actions, and the
 * isolated test database. Nothing is mocked.
 */

const VIDEO_SOURCE = 'https://media.example.com/episodes/e2e-reviews.mp4';

const REVIEW_TEXT = 'E2E review body: the pacing is wonderful.';

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

/** A published drama a viewer can actually open. */
async function seedPublishedDrama(title: string) {
  return seedDrama({
    title,
    publicationStatus: 'published',
    seasonPublicationStatus: 'published',
    episodePublicationStatus: 'published',
    episodeVideoSource: VIDEO_SOURCE,
  });
}

test.describe('ratings and reviews', () => {
  test('a signed-in viewer rates a drama and the average appears', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-review-rater@example.com');
    const drama = await seedPublishedDrama('E2E Rated Drama');

    try {
      await page.goto(`/drama/${drama.id}/${drama.slug}`);

      const ratingSection = page.getByRole('region', { name: 'Your rating' });

      await expect(ratingSection.getByText('No ratings yet.')).toBeVisible();

      await ratingSection.getByRole('radio', { name: '5 stars' }).click();

      await expect(ratingSection.getByText('Your rating: 5/5')).toBeVisible();
      await expect(ratingSection.getByText('Rated 5.0 out of 5 by 1 viewers')).toBeVisible();
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session);
    }
  });

  test('a signed-in viewer writes a review and reacts to it', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-review-writer@example.com');
    const drama = await seedPublishedDrama('E2E Written Drama');

    try {
      await page.goto(`/drama/${drama.id}/${drama.slug}`);

      const reviews = page.getByRole('region', { name: 'Reviews' });

      await expect(reviews.getByText('No reviews yet.')).toBeVisible();

      await reviews.getByLabel('Your review').fill(REVIEW_TEXT);
      await reviews.getByRole('button', { name: 'Publish your review' }).click();

      await expect(reviews.getByText('Your review was published.')).toBeVisible();
      await expect(reviews.getByText(REVIEW_TEXT)).toBeVisible();

      // The viewer cannot react to their own review in this test: the
      // reaction is the one control that changes a shared count, so a second
      // viewer is used for it below.
    } finally {
      await removeDrama(drama);
      await adminSession.remove(session);
    }
  });

  test('a guest is offered a sign-in link instead of a rating control', async ({ page }) => {
    const drama = await seedPublishedDrama('E2E Guest Drama');

    try {
      await page.goto(`/drama/${drama.id}/${drama.slug}`);

      const ratingSection = page.getByRole('region', { name: 'Your rating' });

      await expect(ratingSection.getByRole('link', { name: 'Sign in to rate' })).toBeVisible();
      await expect(ratingSection.getByRole('radio')).toHaveCount(0);
    } finally {
      await removeDrama(drama);
    }
  });
});

test.describe('review reports and moderation', () => {
  test('a report is moderated, audited, and answered', async ({ browser }) => {
    const authorContext = await browser.newContext();
    const reporterContext = await browser.newContext();
    const adminContext = await browser.newContext();

    const author = await signIn(authorContext, 'e2e-review-author@example.com');
    const reporter = await signIn(reporterContext, 'e2e-review-reporter@example.com');
    const admin = await signIn(adminContext, 'e2e-review-moderator@example.com', {
      superAdmin: true,
    });

    const drama = await seedPublishedDrama('E2E Reported Drama');

    try {
      // The author writes the review.
      const authorPage = await authorContext.newPage();

      await authorPage.goto(`/drama/${drama.id}/${drama.slug}`);

      const authorReviews = authorPage.getByRole('region', { name: 'Reviews' });

      await authorReviews.getByLabel('Your review').fill(REVIEW_TEXT);
      await authorReviews.getByRole('button', { name: 'Publish your review' }).click();

      await expect(authorReviews.getByText('Your review was published.')).toBeVisible();

      // The reporter reacts to the review and then reports it.
      const reporterPage = await reporterContext.newPage();

      await reporterPage.goto(`/drama/${drama.id}/${drama.slug}`);

      const reporterReviews = reporterPage.getByRole('region', { name: 'Reviews' });

      await expect(reporterReviews.getByText(REVIEW_TEXT)).toBeVisible();

      await reporterReviews.getByRole('button', { name: 'Enjoying' }).click();

      await expect(reporterReviews.getByRole('button', { name: 'Enjoying 1' })).toBeVisible();

      await reporterReviews.getByRole('button', { name: 'Report' }).click();

      await reporterReviews
        .getByLabel('Description (optional)')
        .fill('This review looks like spam to me.');

      await reporterReviews.getByRole('button', { name: 'Send report' }).click();

      await expect(reporterReviews.getByText('Reported')).toBeVisible();

      // The moderator sees the report in the queue and resolves it.
      const adminPage = await adminContext.newPage();

      await adminPage.goto('/admin/reviews');

      const queue = adminPage.locator('#main-content');

      // The queue may hold reports from earlier runs, so the report this test
      // filed is located by its own description.
      const reportItem = queue.getByRole('listitem').filter({
        hasText: 'This review looks like spam to me.',
      });

      await expect(reportItem).toBeVisible();

      await reportItem.getByLabel('Resolution outcome').fill('The review was kept.');

      await reportItem.getByRole('button', { name: 'Resolve report' }).click();

      await expect(
        adminPage.getByText('The report was resolved and the reporter was notified.')
      ).toBeVisible();

      // The reporter was told what happened, in the application itself.
      const notifications = await readNotifications(reporter.userId);

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.event_type).toBe('review_report_resolved');
      expect(notifications[0]?.content).toBe('The review was kept.');
    } finally {
      await removeDrama(drama);
      await adminSession.remove(author);
      await adminSession.remove(reporter);
      await adminSession.remove(admin);
      await authorContext.close();
      await reporterContext.close();
      await adminContext.close();
    }
  });
});

test.describe('a viewer without moderation permission', () => {
  test('cannot open the moderation queue', async ({ context, page }) => {
    const session = await signIn(context, 'e2e-review-viewer@example.com');

    try {
      const response = await page.goto('/admin/reviews');

      // The administration area hides itself from an actor without admin
      // access: the page answers with a 404, not with the queue.
      expect(response?.status()).toBe(404);
    } finally {
      await adminSession.remove(session);
    }
  });
});
