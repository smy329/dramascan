import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { removeDrama, seedDrama } from './support/drama-fixture.mjs';

/**
 * Browser coverage for the anonymous drama catalogue.
 *
 * The rows are written to the isolated test database so the real query service,
 * the real page, and the real public API are exercised. No application code is
 * mocked. These tests are the public-facing half of the visibility remediation:
 * drafts, hidden empty dramas, and trashed rows must never be reachable, while
 * cards use the canonical route and contain no nested interactive elements.
 */

const IGNORED_CONSOLE_PATTERNS = [
  /favicon\.ico/i,
  /React DevTools/i,
  // The canonical detail route lands in a later remediation phase. Prefetching
  // a route that does not exist yet can log a 404 in development; it is not a
  // catalogue defect and is covered by the detail-route phase instead.
  /404/i,
];

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
    failures.pageErrors.push(error.message);
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      failures.serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  return failures;
}

function cardFor(page: Page, drama: { id: string; slug: string }) {
  return page.locator(`a[href="/drama/${drama.id}/${drama.slug}"]`);
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

test.describe('public drama catalogue visibility', () => {
  test('shows a published coming-soon drama with a canonical, non-nested card link', async ({
    page,
  }) => {
    const failures = watchRuntime(page);

    const visible = await seed({
      title: 'AA E2E Public Visible',
      publicationStatus: 'published',
      visibility: 'coming_soon',
      withEpisodes: false,
    });
    const hidden = await seed({
      title: 'AA E2E Public Hidden Empty',
      publicationStatus: 'published',
      visibility: 'hidden',
      withEpisodes: false,
    });

    const response = await page.goto('/drama', { waitUntil: 'domcontentloaded' });
    expect(response?.status(), 'GET /drama must return a document').toBe(200);

    const card = cardFor(page, visible);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('href', `/drama/${visible.id}/${visible.slug}`);
    await expect(card.getByText('Coming Soon', { exact: true })).toBeVisible();

    // A Hide Until Episodes Available drama without a playable episode is absent.
    await expect(cardFor(page, hidden)).toHaveCount(0);

    // The card is one link and contains no nested interactive element.
    await expect(card.locator('a')).toHaveCount(0);
    await expect(card.locator('[href="#"]')).toHaveCount(0);

    // The obsolete slug-only route must not be emitted.
    await expect(page.locator(`a[href="/drama/${visible.slug}"]`)).toHaveCount(0);

    expect(failures.pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failures.consoleErrors, 'console errors emitted during load').toEqual([]);
    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });

  test('reveals a hidden drama once a playable episode exists', async ({ page }) => {
    const failures = watchRuntime(page);

    const revealed = await seed({
      title: 'AA E2E Public Revealed',
      publicationStatus: 'published',
      visibility: 'hidden',
      seasonPublicationStatus: 'published',
      episodePublicationStatus: 'published',
      episodeVideoSource: 'https://media.example.com/e2e/revealed.mp4',
      seasonCount: 1,
      episodesPerSeason: 1,
    });

    await page.goto('/drama', { waitUntil: 'domcontentloaded' });

    const card = cardFor(page, revealed);
    await expect(card).toBeVisible();
    await expect(card.getByText('Available now', { exact: true })).toBeVisible();
    await expect(card.getByText('Coming Soon', { exact: true })).toHaveCount(0);

    expect(failures.pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failures.consoleErrors, 'console errors emitted during load').toEqual([]);
    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });

  test('crafted query parameters cannot reveal draft or hidden content', async ({ page }) => {
    const failures = watchRuntime(page);

    const draft = await seed({
      title: 'AA E2E Public Draft',
      publicationStatus: 'draft',
      visibility: 'coming_soon',
      withEpisodes: false,
    });
    const hidden = await seed({
      title: 'AA E2E Public Hidden Crafted',
      publicationStatus: 'published',
      visibility: 'hidden',
      withEpisodes: false,
    });

    const response = await page.goto(
      '/drama?publication_status=draft&visibility=hidden&status=draft',
      { waitUntil: 'domcontentloaded' }
    );

    expect(response?.status(), 'crafted filters must not error the page').toBe(200);
    await expect(cardFor(page, draft)).toHaveCount(0);
    await expect(cardFor(page, hidden)).toHaveCount(0);

    expect(failures.pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failures.consoleErrors, 'console errors emitted during load').toEqual([]);
    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });

  test('public API ignores visibility-weakening filters and enforces pagination bounds', async ({
    page,
  }) => {
    const draft = await seed({
      title: 'AA E2E Public API Draft',
      publicationStatus: 'draft',
      visibility: 'hidden',
      withEpisodes: false,
    });
    const visible = await seed({
      title: 'AA E2E Public API Visible',
      publicationStatus: 'published',
      visibility: 'coming_soon',
      withEpisodes: false,
    });

    const weakening = await page.request.get(
      '/public/api/dramas?page=1&pageSize=100&publication_status=draft&visibility=hidden'
    );
    expect(weakening.status()).toBe(200);

    const body = (await weakening.json()) as {
      data: Array<Record<string, unknown>>;
      meta: { page: number; pageSize: number; total: number };
    };

    const ids = body.data.map(item => item.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).toContain(visible.id);
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(100);

    const item = body.data.find(candidate => candidate.id === visible.id);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('publication_status');
    expect(item).not.toHaveProperty('created_at');
    expect(item).not.toHaveProperty('video_source');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('comingSoon', true);

    for (const query of ['page=0', 'pageSize=101', 'page=abc']) {
      const invalid = await page.request.get(`/public/api/dramas?${query}`);
      expect(invalid.status(), `${query} must be rejected`).toBe(400);
    }

    const bounded = await page.request.get('/public/api/dramas?page=1&pageSize=2');
    expect(bounded.status()).toBe(200);

    const boundedBody = (await bounded.json()) as {
      data: unknown[];
      meta: { pageSize: number };
    };

    expect(boundedBody.data.length).toBeLessThanOrEqual(2);
    expect(boundedBody.meta.pageSize).toBe(2);
  });
});
