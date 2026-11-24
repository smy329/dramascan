import { expect, test, type Page } from '@playwright/test';

import { removeDrama, seedDrama } from './support/drama-fixture.mjs';
import { removeMovie, seedMovie } from './support/movie-fixture.mjs';

/**
 * Browser coverage for the public discovery pages.
 *
 * The homepage, the ranking pages, and the browse pages are the face of the
 * catalogue. The browser has to see the same availability rules the server
 * applies: a published title is listed, a draft title is not, and the
 * ranking pages answer with a real grid instead of an error.
 *
 * The rows are written to the isolated test database, so the real read
 * models, the real pages, and the real queries are exercised. No application
 * code is mocked.
 */

const VIDEO_SOURCE = 'https://media.example.com/episodes/e2e-discovery.mp4';

const MOVIE_VIDEO_SOURCE = 'https://media.example.com/movies/e2e-discovery.mp4';

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

/** Watch the console and the server for failures while a page is open. */
function watchRuntime(page: Page) {
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  return { consoleErrors, serverErrors };
}

test.describe('the public discovery pages', () => {
  test('the homepage renders the hero and the ranking rails', async ({ page }) => {
    const failures = watchRuntime(page);
    const drama = await seedPublishedDrama('E2E Homepage Drama');

    try {
      const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

      expect(response?.status()).toBe(200);

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Find your next story' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Popular' })).toBeVisible();

      await page.waitForLoadState('networkidle');

      expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
      expect(failures.consoleErrors, 'console errors emitted during load').toEqual([]);
    } finally {
      await removeDrama(drama);
    }
  });

  test('every ranking page answers with a document', async ({ page }) => {
    const failures = watchRuntime(page);

    for (const path of ['/trending', '/popular', '/highest-rated', '/recently-added']) {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

      expect(response?.status(), `${path} must return a document`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }

    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });

  test('a published title is discoverable and a draft title is not', async ({ page }) => {
    const published = await seedPublishedDrama('E2E Discoverable Drama');
    const draft = await seedDrama({ title: 'E2E Hidden Draft Drama' });

    try {
      await page.goto(`/search?q=${encodeURIComponent('E2E Discoverable Drama')}`);

      await expect(page.getByRole('link', { name: published.title })).toBeVisible();

      await page.goto(`/search?q=${encodeURIComponent('E2E Hidden Draft Drama')}`);

      await expect(page.getByRole('link', { name: draft.title })).toHaveCount(0);
    } finally {
      await removeDrama(published);
      await removeDrama(draft);
    }
  });

  test('the search page finds a published movie', async ({ page }) => {
    const movie = await seedMovie({
      title: 'E2E Discoverable Movie',
      publicationStatus: 'published',
      videoSource: MOVIE_VIDEO_SOURCE,
    });

    try {
      await page.goto(`/search?q=${encodeURIComponent('E2E Discoverable Movie')}`);

      await expect(page.getByRole('link', { name: movie.title })).toBeVisible();
    } finally {
      await removeMovie(movie);
    }
  });

  test('the category and platform browse pages answer with a document', async ({ page }) => {
    const failures = watchRuntime(page);

    for (const path of ['/categories', '/platforms']) {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

      expect(response?.status(), `${path} must return a document`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }

    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });

  test('a type filter narrows the ranking', async ({ page }) => {
    const drama = await seedPublishedDrama('E2E Filter Drama');
    const movie = await seedMovie({
      title: 'E2E Filter Movie',
      publicationStatus: 'published',
      videoSource: MOVIE_VIDEO_SOURCE,
    });

    try {
      await page.goto('/trending?type=drama');

      await expect(page.getByRole('link', { name: drama.title })).toBeVisible();
      await expect(page.getByRole('link', { name: movie.title })).toHaveCount(0);
    } finally {
      await removeDrama(drama);
      await removeMovie(movie);
    }
  });
});

test.describe('the browse catalogues', () => {
  test('the movie catalogue lists a published film', async ({ page }) => {
    const failures = watchRuntime(page);
    const movie = await seedMovie({
      title: 'E2E Catalogue Movie',
      publicationStatus: 'published',
      videoSource: MOVIE_VIDEO_SOURCE,
    });

    try {
      const response = await page.goto('/movie', { waitUntil: 'domcontentloaded' });

      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Feature films' })).toBeVisible();

      // The page used to be a hardcoded empty state that never listed a film.
      await expect(page.getByRole('link', { name: movie.title })).toBeVisible();

      expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
      expect(failures.consoleErrors, 'console errors emitted during load').toEqual([]);
    } finally {
      await removeMovie(movie);
    }
  });

  test('a published movie without a source is not listed', async ({ page }) => {
    const movie = await seedMovie({
      title: 'E2E Sourceless Catalogue Movie',
      publicationStatus: 'published',
    });

    try {
      await page.goto('/movie', { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('link', { name: movie.title })).toHaveCount(0);
    } finally {
      await removeMovie(movie);
    }
  });

  test('the completed-series filter counts the completed dramas only', async ({ page }) => {
    const completed = await seedDrama({
      title: 'E2E Completed Series Drama',
      publicationStatus: 'published',
      status: 'completed',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: VIDEO_SOURCE,
    });
    const ongoing = await seedPublishedDrama('E2E Ongoing Series Drama');

    try {
      await page.goto('/drama?status=completed', { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('link', { name: completed.title })).toBeVisible();
      await expect(page.getByRole('link', { name: ongoing.title })).toHaveCount(0);

      // The old catalogue page reported the number of *all* dramas under
      // "Complete series". The filter now narrows the grid itself.
      await page.goto('/drama', { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('link', { name: completed.title })).toBeVisible();
      await expect(page.getByRole('link', { name: ongoing.title })).toBeVisible();
    } finally {
      await removeDrama(completed);
      await removeDrama(ongoing);
    }
  });

  test('a listed drama without a playable episode is marked as coming soon', async ({ page }) => {
    const drama = await seedDrama({
      title: 'E2E Coming Soon Drama',
      publicationStatus: 'published',
      visibility: 'coming_soon',
      withEpisodes: false,
    });

    try {
      await page.goto('/drama', { waitUntil: 'domcontentloaded' });

      const card = page.locator(`a[href="/drama/${drama.id}/${drama.slug}"]`);

      await expect(card).toBeVisible();
      await expect(card.getByText('Coming Soon', { exact: true })).toBeVisible();
      await expect(card.getByText('Coming soon', { exact: true })).toBeVisible();
      await expect(card.getByText('Available now', { exact: true })).toHaveCount(0);
    } finally {
      await removeDrama(drama);
    }
  });
});
