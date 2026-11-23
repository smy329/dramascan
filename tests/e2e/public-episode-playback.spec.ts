import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { removeDrama, seedDrama } from './support/drama-fixture.mjs';

/**
 * Browser coverage for the anonymous episode watch page.
 *
 * The watch page is the only place where a stored video source reaches a
 * viewer. The rows are written to the isolated test database, so the real
 * query service, the real page, and the real player are exercised; no
 * application code is mocked.
 *
 * The media request itself is intercepted: the test points at a host that does
 * not exist, and the point of the test is the page and the player, not a
 * third-party CDN. The browser therefore never leaves the machine.
 */

const VIDEO_SOURCE = 'https://media.example.com/episodes/e2e-playback.mp4';

/**
 * Console noise that belongs to the deliberately unreachable media host.
 *
 * The player is asked to load a URL that does not resolve. Chromium reports
 * that as a console error and as a failed request; neither is a defect in the
 * application.
 */
const IGNORED_CONSOLE_PATTERNS = [
  /favicon\.ico/i,
  /React DevTools/i,
  /Failed to load resource/i,
  /media\.example\.com/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_INTERNET_DISCONNECTED/i,
];

/**
 * Page errors that are not application defects.
 *
 * Every page that calls `notFound()` — this one and the pre-existing
 * information-page 404 alike — makes the browser report an unhandled
 * rejection carrying an `Event` while the development server runs. The
 * rejection carries no message and no stack, and it does not happen for a
 * route that simply does not exist, so it comes from the framework's
 * development-time handling of the not-found boundary rather than from the
 * application. It is ignored here so that a real exception is still a
 * failure.
 */
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

const seeded: Array<Awaited<ReturnType<typeof seedDrama>>> = [];

async function seed(options: Parameters<typeof seedDrama>[0]) {
  const drama = await seedDrama(options);
  seeded.push(drama);
  return drama;
}

test.afterEach(async () => {
  while (seeded.length > 0) {
    const drama = seeded.pop();
    if (drama) {
      await removeDrama(drama);
    }
  }
});

test.describe('public episode playback', () => {
  test('plays a published episode from the stored direct source', async ({ page }) => {
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

    // The episode title is the page's heading.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Episode 1.1');

    // The player is a real Vidstack player, not a placeholder.
    await expect(page.locator('[data-media-player]')).toHaveCount(1);

    // The browser is handed the stored URL unchanged: the application server
    // does not proxy, relay, or rehost the media.
    const video = page.locator('video');
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute('src', VIDEO_SOURCE);

    // The page says where the media comes from, so a viewer is not left
    // guessing.
    await expect(page.getByText(/streamed directly from its external host/i)).toBeVisible();

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('does not expose an episode that is not published', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'draft',
      episodeVideoSource: VIDEO_SOURCE,
      episodesPerSeason: 1,
    });

    const episodeId = drama.episodeIds[0];
    expect(episodeId).toBeTruthy();

    const response = await page.goto(`/drama/${drama.id}/${drama.slug}/episode/${episodeId}`);

    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-media-player]')).toHaveCount(0);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
  });

  test('does not expose an episode without a stored source', async ({ page }) => {
    const failures = watchRuntime(page);
    await blockMediaRequests(page);

    const drama = await seed({
      publicationStatus: 'published',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: null,
      episodesPerSeason: 1,
    });

    const episodeId = drama.episodeIds[0];
    expect(episodeId).toBeTruthy();

    const response = await page.goto(`/drama/${drama.id}/${drama.slug}/episode/${episodeId}`);

    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-media-player]')).toHaveCount(0);

    expect(failures.pageErrors).toEqual([]);
    expect(failures.serverErrors).toEqual([]);
  });
});
