import { expect, test, type BrowserContext } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';

/**
 * Browser coverage for the `/admin/roles` console and the role/status
 * controls on `/admin/users`.
 *
 * The session is seeded through the test-only helper, so the application
 * performs its real session lookup, account-status gate, actor resolution, and
 * Super Admin check — nothing is mocked. Every mutation goes through the
 * method-correct admin API, so the assertions cover the real request/response
 * contract rather than a client-side state change.
 */

/** The session shape the test-only seeder returns. */
type SeededSession = {
  userId: string;
  cookieName: string;
  cookieValue: string;
};

async function signIn(context: BrowserContext, session: SeededSession): Promise<void> {
  await context.addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('admin roles console', () => {
  test('creates a role, grants it a permission, and deletes it again', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-roles-console@example.com' });
    let roleId: string | null = null;

    try {
      await signIn(context, session);

      await page.goto('/admin/roles');

      await expect(page.getByRole('heading', { name: 'Roles & permissions' })).toBeVisible();

      // Create the role through the admin API and the console.
      await page.getByLabel('Role name').fill('e2e_role');
      await page.getByLabel('Description').fill('Created by the end-to-end suite.');
      await page.getByRole('button', { name: 'Create role' }).click();

      await expect(page.getByRole('cell', { name: 'e2e_role', exact: true })).toBeVisible();

      // The role really exists in the database, not only in the browser.
      const listed = await page.request.get('/admin/api/roles');
      expect(listed.status()).toBe(200);
      const body = (await listed.json()) as { data: { id: string; name: string }[] };
      const created = body.data.find(role => role.name === 'e2e_role');

      expect(created).toBeTruthy();
      roleId = created?.id ?? null;

      // Grant one permission through the permission editor.
      await page.getByRole('button', { name: 'Manage permissions for e2e_role' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('checkbox', { name: 'drama.read', exact: true }).check();
      await page.getByRole('button', { name: 'Save permissions' }).click();

      await expect(dialog).toBeHidden();

      const afterGrant = await page.request.get('/admin/api/roles');
      const afterGrantBody = (await afterGrant.json()) as {
        data: { id: string; grantedPermissionKeys: string[] }[];
      };
      const granted = afterGrantBody.data.find(role => role.id === roleId);

      expect(granted?.grantedPermissionKeys).toEqual(['drama.read']);

      // The role now holds an assignment-free state, so it can be deleted.
      await page.getByRole('button', { name: 'Delete role e2e_role' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();

      await expect(page.getByRole('cell', { name: 'e2e_role', exact: true })).toHaveCount(0);
    } finally {
      if (roleId) {
        await adminSession.removeRole(roleId);
      }
      await adminSession.remove(session.userId);
    }
  });

  test('refuses a signed-in account that is not a Super Admin', async ({ context, page }) => {
    const session = await adminSession.seed({
      email: 'e2e-roles-forbidden@example.com',
      name: 'E2E Ordinary User',
      superAdmin: false,
    });

    try {
      await signIn(context, session);

      const response = await page.goto('/admin/roles');

      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: 'Roles & permissions' })).toHaveCount(0);
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('assigns a role to an account and changes its status', async ({ context, page }) => {
    const admin = await adminSession.seed({ email: 'e2e-roles-admin@example.com' });
    const targetEmail = 'e2e-roles-target@example.com';
    const target = await adminSession.seed({
      email: targetEmail,
      name: 'E2E Target User',
      superAdmin: false,
    });
    let roleId: string | null = null;

    try {
      await signIn(context, admin);

      await page.goto('/admin/roles');

      await page.getByLabel('Role name').fill('e2e_assign_role');
      await page.getByRole('button', { name: 'Create role' }).click();
      await expect(page.getByRole('cell', { name: 'e2e_assign_role', exact: true })).toBeVisible();

      const listed = await page.request.get('/admin/api/roles');
      const body = (await listed.json()) as { data: { id: string; name: string }[] };
      roleId = body.data.find(role => role.name === 'e2e_assign_role')?.id ?? null;
      expect(roleId).toBeTruthy();

      // Assign the role from the users listing.
      await page.goto('/admin/users?q=e2e-roles-target');
      await expect(page.getByRole('cell', { name: targetEmail })).toBeVisible();

      await page.getByRole('button', { name: 'Manage roles for E2E Target User' }).click();

      const rolesDialog = page.getByRole('dialog');
      await expect(rolesDialog).toBeVisible();
      await rolesDialog.getByRole('checkbox', { name: 'e2e_assign_role' }).check();
      await page.getByRole('button', { name: 'Done' }).click();

      // The assignment is real: the listing shows the role again.
      await expect(page.getByRole('list', { name: 'Roles of E2E Target User' })).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Roles of E2E Target User' }).getByText('e2e_assign_role')
      ).toBeVisible();

      // Deactivate the account through the status control.
      await page.getByRole('button', { name: 'Deactivate E2E Target User' }).click();

      await expect(page.getByRole('button', { name: 'Reactivate E2E Target User' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Deactivated', exact: true })).toBeVisible();

      // Reactivate it again so the seeded account is left usable.
      await page.getByRole('button', { name: 'Reactivate E2E Target User' }).click();
      await expect(page.getByRole('button', { name: 'Deactivate E2E Target User' })).toBeVisible();
    } finally {
      if (roleId) {
        await adminSession.removeRole(roleId);
      }
      await adminSession.remove(admin.userId);
      await adminSession.remove(target.userId);
    }
  });
});
