import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Browser smoke coverage for the public site.
 *
 * These tests exist to prove that the application actually runs: Next.js
 * renders, React hydrates without throwing, the primary public routes return
 * documents rather than error pages, and footer navigation responds.
 *
 * They are deliberately small. Business-flow coverage belongs in dedicated
 * specs once the corresponding features exist.
 */

const IGNORED_CONSOLE_PATTERNS = [
  // There is no favicon asset yet; Chromium reports the 404 as a console error.
  /favicon\.ico/i,
  // React DevTools suggests installing the extension in development builds.
  /React DevTools/i,
];

type RuntimeFailures = {
  consoleErrors: string[];
  pageErrors: string[];
  serverErrors: string[];
};

function watchRuntime(page: Page): RuntimeFailures {
  const failures: RuntimeFailures = {
    consoleErrors: [],
    pageErrors: [],
    serverErrors: [],
  };

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') {
      return;
    }

    const text = message.text();
    if (IGNORED_CONSOLE_PATTERNS.some(pattern => pattern.test(text))) {
      return;
    }

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

async function openHome(page: Page): Promise<RuntimeFailures> {
  const failures = watchRuntime(page);

  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

  expect(response?.status(), 'GET / must return a document').toBe(200);
  await expect(page).toHaveTitle(/DramaScan/);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'International drama and movies, in one place.',
    })
  ).toBeVisible();

  // Let hydration and any deferred client work finish before asserting.
  await page.waitForLoadState('networkidle');

  return failures;
}

test.describe('public site smoke', () => {
  test('home page renders without runtime errors', async ({ page }) => {
    const failures = await openHome(page);

    expect(failures.pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failures.consoleErrors, 'console errors emitted during load').toEqual([]);
    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });

  test('footer navigation reaches the primary public routes', async ({ page }) => {
    const failures = await openHome(page);

    const destinations = [
      { label: 'Dramas', path: '/drama', heading: 'Drama Series Collection' },
      { label: 'Movies', path: '/movie', heading: 'Feature Film Collection' },
      { label: 'Categories', path: '/categories', heading: 'Browse by Category' },
      { label: 'Platforms', path: '/platforms', heading: 'Streaming Platforms' },
    ] as const;

    for (const destination of destinations) {
      await page.locator('footer').getByRole('link', { name: destination.label }).first().click();

      await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
      await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(
        destination.heading
      );

      // Return home so every destination is reached through a click, not a
      // direct `page.goto`, which would not exercise link behaviour.
      await page.locator('footer').getByRole('link', { name: 'Home' }).first().click();
      await expect(page).toHaveURL(/\/$/);
    }

    expect(failures.pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failures.consoleErrors, 'console errors emitted during navigation').toEqual([]);
    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });
});
