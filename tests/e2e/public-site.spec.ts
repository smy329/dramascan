import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Browser smoke coverage for the public site.
 *
 * These tests exist to prove that the application actually runs and that the
 * public shell is usable at both breakpoints: the header renders on desktop,
 * the bottom bar renders on mobile, the menu opens and closes, primary
 * navigation responds, and text is actually readable against the dark surface.
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

/** Computed foreground colour of an element, as an `rgb(...)` string. */
async function foregroundColor(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate(element => getComputedStyle(element).color);
}

test.describe('public site shell', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('desktop header, navigation, and readable text', async ({ page }) => {
    const failures = await openHome(page);

    const header = page.locator('header').first();
    await expect(header).toBeVisible();

    const primaryNav = page.getByRole('navigation', { name: 'Primary', exact: true });
    await expect(primaryNav).toBeVisible();

    for (const label of ['Home', 'Dramas', 'Movies', 'Categories', 'Platforms']) {
      await expect(primaryNav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();

    // The primary call to action must have a real background, not the
    // transparent fallback that appeared when Tailwind utilities were missing.
    const cta = page.getByRole('link', { name: 'Browse dramas' }).first();
    const ctaBackground = await cta.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(ctaBackground, 'primary CTA must not be transparent').not.toBe('rgba(0, 0, 0, 0)');

    // The page is dark; body text must not be the browser default black.
    const bodyColor = await foregroundColor(page, 'body');
    const background = await page
      .locator('body')
      .evaluate(element => getComputedStyle(element).backgroundColor);
    expect(bodyColor, 'body text must not be black').not.toBe('rgb(0, 0, 0)');
    expect(background, 'body must use the dark surface').not.toBe('rgba(0, 0, 0, 0)');

    // Header navigation actually navigates.
    await primaryNav.getByRole('link', { name: 'Dramas', exact: true }).click();
    await expect(page).toHaveURL(/\/drama$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Drama series' })).toBeVisible();

    expect(failures.pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failures.consoleErrors, 'console errors emitted during load').toEqual([]);
    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });

  test('footer reaches every public route', async ({ page }) => {
    const failures = await openHome(page);

    const destinations = [
      { label: 'Dramas', path: '/drama', heading: 'Drama series' },
      { label: 'Movies', path: '/movie', heading: 'Feature films' },
      { label: 'Categories', path: '/categories', heading: 'Categories' },
      { label: 'Platforms', path: '/platforms', heading: 'Platforms' },
      { label: 'Trending', path: '/trending', heading: 'Trending' },
      { label: 'Bookmarks', path: '/bookmark', heading: 'Bookmarks' },
      { label: 'Help', path: '/help', heading: 'Help' },
    ] as const;

    for (const destination of destinations) {
      await page
        .locator('footer')
        .getByRole('link', { name: destination.label, exact: true })
        .first()
        .click();

      await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
      await expect(page.getByRole('heading', { level: 1, name: destination.heading })).toBeVisible();

      // Return home through the brand link so every destination is reached by
      // clicking, not by a direct `page.goto`.
      await page
        .locator('header')
        .getByRole('link', { name: 'DramaScan home' })
        .first()
        .click();
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: 'International drama and movies, in one place.',
        })
      ).toBeVisible();
    }

    expect(failures.pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failures.consoleErrors, 'console errors emitted during navigation').toEqual([]);
    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });
});

test.describe('public site mobile shell', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('bottom bar renders and the menu opens, closes, and navigates', async ({ page }) => {
    const failures = await openHome(page);

    await expect(page.locator('header').first()).toBeVisible();

    const bottomNav = page.getByRole('navigation', { name: 'Primary mobile' });
    await expect(bottomNav).toBeVisible();

    for (const label of ['Home', 'Trending', 'Bookmark', 'Sign in']) {
      await expect(bottomNav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await menuButton.click();

    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await expect(dialog).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    for (const label of ['Dramas', 'Movies', 'Categories', 'Platforms', 'Trending', 'Bookmark', 'Help']) {
      await expect(dialog.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    // Escape closes the menu.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Reopen and navigate through the menu.
    await menuButton.click();
    await dialog.getByRole('link', { name: 'Categories', exact: true }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible();

    // Menu closes after navigation.
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden();

    expect(failures.pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failures.consoleErrors, 'console errors emitted during navigation').toEqual([]);
    expect(failures.serverErrors, 'server responses with status >= 500').toEqual([]);
  });
});
