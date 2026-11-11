import { expect, test } from '@playwright/test';

test.describe('admin access', () => {
  test('redirects anonymous visitors to sign in with the admin callback', async ({ page }) => {
    const response = await page.goto('/admin');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=%2Fadmin$/);
    await expect(page.getByRole('heading', { name: 'Sign in to DramaScan' })).toBeVisible();
    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue('/admin');
  });

  test('never forwards an external callback URL to the sign-in form', async ({ page }) => {
    await page.goto('/auth/signin?callbackUrl=https%3A%2F%2Fevil.example%2Fadmin');

    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue('/dashboard');
  });
});
