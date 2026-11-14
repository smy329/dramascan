import { expect, test } from '@playwright/test';

test.describe('admin access', () => {
  test('redirects anonymous visitors to the vault sign-in with the admin callback', async ({
    page,
  }) => {
    const response = await page.goto('/admin');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/vault-7x9k-console\?callbackUrl=%2Fadmin$/);
    await expect(page.getByRole('heading', { name: 'Super Admin sign in' })).toBeVisible();
  });

  // The admin shell's layout is the boundary that answers an anonymous
  // request, and it asks for the shell path, so the callback is `/admin`
  // rather than the deep path. The visitor still reaches sign in, and the
  // destination stays inside the admin area.
  test('redirects anonymous visitors from the users listing to the vault sign-in', async ({
    page,
  }) => {
    const response = await page.goto('/admin/users');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/vault-7x9k-console\?callbackUrl=%2Fadmin$/);
    await expect(page.getByRole('heading', { name: 'Super Admin sign in' })).toBeVisible();
  });

  test('never forwards an external callback URL to the sign-in form', async ({ page }) => {
    await page.goto('/auth/signin?callbackUrl=https%3A%2F%2Fevil.example%2Fadmin');

    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue('/dashboard');
  });

  test('never forwards an external callback URL to the vault form', async ({ page }) => {
    await page.goto('/vault-7x9k-console?callbackUrl=https%3A%2F%2Fevil.example%2Fadmin');

    await expect(page.getByRole('heading', { name: 'Super Admin sign in' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('evil.example');
  });
});
