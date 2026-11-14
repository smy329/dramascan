import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  removeSuperAdminCredential,
  seedSuperAdminCredential,
} from './support/credential-account.mjs';

/**
 * End-to-end coverage for the Super Admin email/password route.
 *
 * The credential is provisioned in the isolated test database and the browser
 * drives the real form, so Better Auth's sign-in, the session hook, and the
 * admin authorization gate all run for real.
 */

const SIGN_IN_PATH = '/vault-7x9k-console';
const PASSWORD = 'e2e-super-admin-password-1';

function uniqueEmail(): string {
  return `e2e-super-admin-${randomUUID()}@example.com`;
}

test.describe('Super Admin password sign-in', () => {
  const seededEmails: string[] = [];

  test.afterAll(async () => {
    for (const email of seededEmails) {
      await removeSuperAdminCredential(email);
    }
  });

  test('signs in with the seeded credential and reaches the admin area', async ({ page }) => {
    const email = uniqueEmail();
    seededEmails.push(email);
    await seedSuperAdminCredential({ email, password: PASSWORD });

    await page.goto(SIGN_IN_PATH);
    await expect(page.getByRole('heading', { name: 'Super Admin sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test('rejects a wrong password without leaving the vault route', async ({ page }) => {
    const email = uniqueEmail();
    seededEmails.push(email);
    await seedSuperAdminCredential({ email, password: PASSWORD });

    await page.goto(SIGN_IN_PATH);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password.', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${SIGN_IN_PATH}$`));
  });

  test('rejects an unknown email with the same generic message', async ({ page }) => {
    await page.goto(SIGN_IN_PATH);
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password.', { exact: true })).toBeVisible();
  });

  test('is not indexable by search engines', async ({ page }) => {
    await page.goto(SIGN_IN_PATH);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/
    );
  });
});
