import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { removeDrama, seedDrama } from './support/drama-fixture.mjs';
import { removeMovie, seedMovie } from './support/movie-fixture.mjs';
import { recordSlugChange } from './support/slug-history-fixture.mjs';

/**
 * Browser coverage for the public details pages and the episode navigation.
 *
 * The details pages are the public face of the content module, so the browser
 * has to see the same availability rules the server applies: a draft or
 * trashed item is a 404, an unpublished episode never appears in the episode
 * list, and the episode links follow the canonical URL and the real content
 * order.
 *
 * The rows are written to the isolated test database, so the real query
 * services, the real pages, and the real player are exercised; no application
 * code is mocked.
 */

const VIDEO_SOURCE = 'https://media.example.com/episodes/e2e-details.mp4';

/** Console noise that belongs to the deliberately unreachable media host. */
const IGNORED_CONSOLE_PATTERNS = [
  /Failed to load resource/i,
  /media\.example\.com/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_INTERNET_DISCONNECTED/i,
];

const IGNORED_PAGE_ERROR_PATTERNS = [/^Event$/, /^: Event$/];

function isIgnoredPageError(message: string): boolean {
  return IGNORED_PAGE_ERROR_PATTERNS.some(pattern => pattern.test(message.trim()));
}

type RuntimeFailures = {
  consoleErrors: string[];
  pageErrors: string[];
  serverErrors: string[];
};

function watchRuntime(page: Page): RuntimeFailures {
  const failures: RuntimeFailures = { consoleErrors: [], pageErrors: [], serverErrors: [] };

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;

    const text = message.text();
    if (IGNORED_CONSOLE_PATTERNS.some(pattern => pattern.test(text))) return;

    failures.consoleErrors.push(text);
  });

  page.on('pageerror', error => {
    if (isIgnoredPageError(error.message)) return;

    failures.pageErrors.push(error.message);
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      failures.serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  return failures;
}

/** Stop the media request at the browser so the test never leaves the machine. */
async function blockMediaRequests(page: Page): Promise<void> {
  await page.route('**/*.mp4', route => route.abort());
}

const seededDramas: Array<Awaited<ReturnType<typeof seedDrama>>> = [];
const seededMovies: Array<Awaited<ReturnType<typeof seedMovie>>> = [];

async function seed(options: Parameters<typeof seedDrama>[0]) {
  const drama = await seedDrama(options);
  seededDramas.push(drama);
  return drama;
}

async function seedFilm(options: Parameters<typeof seedMovie>[0]) {
  const movie = await seedMovie(options);
  seededMovies.push(movie);
  return movie;
}

test.afterEach(async () => {
  while (seededDramas.length > 0) {
    const drama = seededDramas.pop();
    if (drama) {
      await removeDrama(drama);
    }
  }

  while (seededMovies.length > 0) {
    const movie = seededMovies.pop();
    if (movie) {
      await removeMovie(movie);
    }
  }
});

test.describe('public drama details page', () => {
  test('shows the drama, its episodes, and a way into the first episode', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: VIDEO_SOURCE,
      episodesPerSeason: 2,
    });

    const response = await page.goto(`/drama/${drama.id}/${drama.slug}`);

    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(drama.title);

    // The episode count and the season are part of the page.
    await expect(page.getByRole('heading', { name: 'Episodes', level: 2 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Episodes' })).toBeVisible();
    await expect(page.getByText('Season 1').first()).toBeVisible();

    // The first episode is reachable from the page.
    const firstEpisodeId = drama.episodeIds[0];
    expect(firstEpisodeId).toBeTruthy();

    await expect(page.getByRole('link', { name: /play episode 1/i })).toHaveAttribute(
      'href',
      `/drama/${drama.id}/${drama.slug}/episode/${firstEpisodeId}`
    );

    // The episode navigation links to the canonical episode URLs.
    const navigation = page.getByRole('navigation', { name: 'Episodes' });

    await expect(navigation.getByRole('link', { name: /episode 1/i }).first()).toHaveAttribute(
      'href',
      `/drama/${drama.id}/${drama.slug}/episode/${firstEpisodeId}`
    );

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('does not expose an unpublished episode in the navigation', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'draft',
      episodeVideoSource: VIDEO_SOURCE,
      episodesPerSeason: 1,
    });

    const response = await page.goto(`/drama/${drama.id}/${drama.slug}`);

    expect(response?.status()).toBe(200);

    // The drama itself is published, so the page exists — but it has nothing
    // playable, and the draft episode is not part of the navigation.
    await expect(page.getByRole('navigation', { name: 'Episodes' })).toHaveCount(0);
    await expect(page.getByText(/no episodes are available yet/i)).toBeVisible();

    // The draft episode is a 404 when it is requested directly.
    const draftResponse = await page.goto(
      `/drama/${drama.id}/${drama.slug}/episode/${drama.episodeIds[0]}`
    );

    expect(draftResponse?.status()).toBe(404);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
  });

  test('does not expose a drama that is not published', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'unpublished',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: VIDEO_SOURCE,
      episodesPerSeason: 1,
    });

    const response = await page.goto(`/drama/${drama.id}/${drama.slug}`);

    expect(response?.status()).toBe(404);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
  });

  test('does not serve a guessed slug', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: VIDEO_SOURCE,
      episodesPerSeason: 1,
    });

    const response = await page.goto(`/drama/${drama.id}/a-guessed-slug`);

    expect(response?.status()).toBe(404);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
  });

  test('lets the viewer choose a season in the episode navigation', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: VIDEO_SOURCE,
      seasonCount: 2,
      episodesPerSeason: 1,
    });

    const response = await page.goto(`/drama/${drama.id}/${drama.slug}`);

    expect(response?.status()).toBe(200);

    // The season selector is a tab list: one tab per season, and the panel
    // of the selected season holds its episodes.
    const navigation = page.getByRole('navigation', { name: 'Episodes' });
    const seasonOne = page.getByRole('tab', { name: 'Season 1' });
    const seasonTwo = page.getByRole('tab', { name: 'Season 2' });

    await expect(page.getByRole('tablist', { name: 'Seasons' })).toBeVisible();
    await expect(seasonOne).toHaveAttribute('aria-selected', 'true');
    await expect(seasonTwo).toHaveAttribute('aria-selected', 'false');

    // The first season is open, and the second one is not.
    await expect(navigation.getByRole('link', { name: /episode 1/i })).toBeVisible();
    await expect(navigation.getByRole('link', { name: /episode 2/i })).toBeHidden();

    await seasonTwo.click();

    await expect(seasonTwo).toHaveAttribute('aria-selected', 'true');
    await expect(seasonOne).toHaveAttribute('aria-selected', 'false');
    await expect(navigation.getByRole('link', { name: /episode 2/i })).toBeVisible();
    await expect(navigation.getByRole('link', { name: /episode 1/i })).toBeHidden();

    // The episode of the second season is reachable from the panel.
    const secondSeasonEpisodeId = drama.episodeIds[1];
    expect(secondSeasonEpisodeId).toBeTruthy();

    await expect(navigation.getByRole('link', { name: /episode 2/i })).toHaveAttribute(
      'href',
      `/drama/${drama.id}/${drama.slug}/episode/${secondSeasonEpisodeId}`
    );

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('redirects an old slug to the current canonical URL', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: VIDEO_SOURCE,
      episodesPerSeason: 1,
    });

    const oldSlug = `${drama.slug}-before-the-rename`;

    await recordSlugChange({
      contentType: 'drama',
      contentId: drama.id,
      oldSlug,
      newSlug: drama.slug,
    });

    // The old URL answers with a redirect to the canonical URL.
    const redirectResponse = await page.request.get(`/drama/${drama.id}/${oldSlug}`, {
      maxRedirects: 0,
    });

    expect(redirectResponse.status()).toBeGreaterThanOrEqual(300);
    expect(redirectResponse.status()).toBeLessThan(400);
    expect(redirectResponse.headers()['location']).toBe(`/drama/${drama.id}/${drama.slug}`);

    // The browser follows it and lands on the canonical page.
    const response = await page.goto(`/drama/${drama.id}/${oldSlug}`);

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(`/drama/${drama.id}/${drama.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(drama.title);

    // The episode URL keeps working as well.
    const episodeId = drama.episodeIds[0];
    expect(episodeId).toBeTruthy();

    await page.goto(`/drama/${drama.id}/${oldSlug}/episode/${episodeId}`);

    await expect(page).toHaveURL(`/drama/${drama.id}/${drama.slug}/episode/${episodeId}`);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });
});

test.describe('public watch page navigation', () => {
  test('links to the next episode in the published content order', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: VIDEO_SOURCE,
      episodesPerSeason: 2,
    });

    const firstEpisodeId = drama.episodeIds[0];
    const secondEpisodeId = drama.episodeIds[1];

    expect(firstEpisodeId).toBeTruthy();
    expect(secondEpisodeId).toBeTruthy();

    const response = await page.goto(
      `/drama/${drama.id}/${drama.slug}/episode/${firstEpisodeId}`
    );

    expect(response?.status()).toBe(200);

    const nextLink = page.getByRole('link', { name: /next episode/i });
    await expect(nextLink).toHaveAttribute(
      'href',
      `/drama/${drama.id}/${drama.slug}/episode/${secondEpisodeId}`
    );

    // The current episode is marked in the navigation.
    await expect(
      page
        .getByRole('navigation', { name: 'Episodes' })
        .getByRole('link', { name: /episode 1/i })
        .first()
    ).toHaveAttribute('aria-current', 'page');

    await nextLink.click();

    await expect(page).toHaveURL(
      `/drama/${drama.id}/${drama.slug}/episode/${secondEpisodeId}`
    );

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('shows an end-of-content state for the last episode', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: VIDEO_SOURCE,
      episodesPerSeason: 1,
    });

    const episodeId = drama.episodeIds[0];
    expect(episodeId).toBeTruthy();

    const response = await page.goto(`/drama/${drama.id}/${drama.slug}/episode/${episodeId}`);

    expect(response?.status()).toBe(200);

    await expect(page.getByText(/end of the published episodes/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /next episode/i })).toHaveCount(0);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
  });
});

test.describe('public movie details page', () => {
  test('shows the film and links to the watch page', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const movie = await seedFilm({
      publicationStatus: 'published',
      videoSource: VIDEO_SOURCE,
    });

    const response = await page.goto(`/movie/${movie.id}/${movie.slug}`);

    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(movie.title);

    await expect(page.getByRole('link', { name: /^play$/i })).toHaveAttribute(
      'href',
      `/movie/${movie.id}/${movie.slug}/watch`
    );

    // A movie has no season or episode navigation.
    await expect(page.getByRole('navigation', { name: 'Episodes' })).toHaveCount(0);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('plays the stored source on the watch page', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const movie = await seedFilm({
      publicationStatus: 'published',
      videoSource: VIDEO_SOURCE,
    });

    const response = await page.goto(`/movie/${movie.id}/${movie.slug}/watch`);

    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(movie.title);
    await expect(page.locator('video')).toHaveAttribute('src', VIDEO_SOURCE);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('does not expose a movie that is not published', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const movie = await seedFilm({
      publicationStatus: 'draft',
      videoSource: VIDEO_SOURCE,
    });

    const response = await page.goto(`/movie/${movie.id}/${movie.slug}`);

    expect(response?.status()).toBe(404);

    const watchResponse = await page.goto(`/movie/${movie.id}/${movie.slug}/watch`);

    expect(watchResponse?.status()).toBe(404);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
  });

  test('does not expose a published movie without a source', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    // A published movie without a playable source is not reachable: the
    // details page, the watch route, and the bookmark write all answer the
    // same question.
    const movie = await seedFilm({
      publicationStatus: 'published',
      videoSource: null,
    });

    const response = await page.goto(`/movie/${movie.id}/${movie.slug}`);

    expect(response?.status()).toBe(404);

    const watchResponse = await page.goto(`/movie/${movie.id}/${movie.slug}/watch`);

    expect(watchResponse?.status()).toBe(404);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
  });

  test('redirects an old movie slug to the current canonical URL', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const movie = await seedFilm({
      publicationStatus: 'published',
      videoSource: VIDEO_SOURCE,
    });

    const oldSlug = `${movie.slug}-before-the-rename`;

    await recordSlugChange({
      contentType: 'movie',
      contentId: movie.id,
      oldSlug,
      newSlug: movie.slug,
    });

    const redirectResponse = await page.request.get(`/movie/${movie.id}/${oldSlug}`, {
      maxRedirects: 0,
    });

    expect(redirectResponse.status()).toBeGreaterThanOrEqual(300);
    expect(redirectResponse.status()).toBeLessThan(400);
    expect(redirectResponse.headers()['location']).toBe(`/movie/${movie.id}/${movie.slug}`);

    const response = await page.goto(`/movie/${movie.id}/${oldSlug}`);

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(`/movie/${movie.id}/${movie.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(movie.title);

    // The watch URL keeps working as well.
    await page.goto(`/movie/${movie.id}/${oldSlug}/watch`);

    await expect(page).toHaveURL(`/movie/${movie.id}/${movie.slug}/watch`);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });
});
