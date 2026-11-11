import { expect, test, type Page } from '@playwright/test';

/**
 * Browser coverage for the configurable legal/information footer row and the
 * public `/information/[slug]` pages it links to.
 *
 * The seed migration provides six published pages. These tests verify the
 * rendered order, wrapping at small widths, real navigation, 404 behaviour for
 * unpublished/missing content, and that the admin API is not publicly readable.
 */

const LEGAL_LINKS = [
  { label: 'Terms of Service', slug: 'terms' },
  { label: 'Privacy Policy', slug: 'privacy' },
  { label: 'Community Guidelines', slug: 'community-guidelines' },
  { label: 'Copyright / DMCA', slug: 'copyright-dmca' },
  { label: 'About', slug: 'about' },
  { label: 'Contact', slug: 'contact' },
] as const;

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function openHome(page: Page): Promise<void> {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

  expect(response?.status(), 'GET / must return a document').toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.describe('footer information links', () => {
  for (const viewport of VIEWPORTS) {
    test(`renders all six links in canonical order at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openHome(page);

      const legalNav = page.locator('footer nav[aria-label="Legal and information"]');
      await expect(legalNav).toBeVisible();

      const links = legalNav.getByRole('link');
      await expect(links).toHaveCount(LEGAL_LINKS.length);
      await expect(links).toHaveText(LEGAL_LINKS.map(link => link.label));

      const flexWrap = await legalNav
        .locator('ul')
        .evaluate(element => getComputedStyle(element).flexWrap);
      expect(flexWrap, 'legal links must be allowed to wrap').toBe('wrap');

      // Scope the overflow assertion to the footer. At tablet widths the
      // pre-existing header navigation can overflow, and that is not what this
      // footer prompt owns.
      const footerOverflows = await page
        .locator('footer')
        .evaluate(element => element.scrollWidth > element.clientWidth + 1);
      expect(footerOverflows, 'footer must not create horizontal overflow').toBe(false);

      const linksOutOfBounds = await links.evaluateAll(nodes =>
        nodes.some(node => {
          const rect = node.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1;
        })
      );
      expect(linksOutOfBounds, 'legal links must stay inside the viewport').toBe(false);

      if (viewport.name === 'mobile') {
        const lineCount = await links.evaluateAll(nodes => {
          const tops = new Set(nodes.map(node => Math.round(node.getBoundingClientRect().top)));
          return tops.size;
        });
        expect(lineCount, 'six legal links must wrap onto multiple lines on mobile').toBeGreaterThan(
          1
        );
      }
    });
  }

  test('every legal link navigates to its published page', async ({ page, request }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 900 });

    // Warm the dynamic route compilation so the navigation assertions measure
    // the footer link, not Turbopack's first-request compile time.
    for (const link of LEGAL_LINKS) {
      const warmup = await request.get(`/information/${link.slug}`, { timeout: 60_000 });
      expect(warmup.status(), `GET /information/${link.slug}`).toBe(200);
    }

    await openHome(page);

    for (const link of LEGAL_LINKS) {
      await page
        .locator('footer nav[aria-label="Legal and information"]')
        .getByRole('link', { name: link.label, exact: true })
        .click();

      await expect(page).toHaveURL(new RegExp(`/information/${link.slug}$`), {
        timeout: 30_000,
      });
      await expect(page.getByRole('heading', { level: 1, name: link.label })).toBeVisible();
      await expect(page.getByText('This page is being prepared.')).toBeVisible();

      await page
        .locator('header')
        .getByRole('link', { name: 'DramaScan home' })
        .first()
        .click();
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test('missing information pages return 404', async ({ page }) => {
    const response = await page.goto('/information/this-page-does-not-exist', {
      waitUntil: 'domcontentloaded',
    });

    expect(response?.status()).toBe(404);
  });

  test('the admin information-page API is not public', async ({ request }) => {
    test.slow();

    const listResponse = await request.get('/admin/api/information-pages', { timeout: 60_000 });
    expect(listResponse.status()).toBe(401);

    const body = (await listResponse.json()) as {
      error?: { code?: string; requestId?: string };
    };
    expect(body.error?.code).toBe('authentication_required');
    expect(listResponse.headers()['x-request-id']).toBeTruthy();
    expect(body.error?.requestId).toBeTruthy();

    const updateResponse = await request.patch(
      '/admin/api/information-pages/0198f3a2-0000-7000-8000-000000000001',
      { data: { title: 'Unauthorized' } }
    );
    expect(updateResponse.status()).toBe(401);

    const reorderResponse = await request.put('/admin/api/information-pages/reorder', {
      data: { ids: ['0198f3a2-0000-7000-8000-000000000001'] },
    });
    expect(reorderResponse.status()).toBe(401);
  });
});
