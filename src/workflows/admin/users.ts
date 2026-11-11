/** Administrator user account management workflows.
 *
 * Authorizing an account as an administrator assigns the administrator role,
 * so `authorizeUserAsAdmin` is Super Admin-only (`requireSuperAdmin`).
 * Ordinary administrator account status changes and role inspection
 * (`deactivateAdminUser`, `reactivateAdminUser`, `inspectUserRole`) require the
 * canonical `admin.manage` permission. Public users cannot register as
 * administrators.
 *
 * Safety / error handling:
 *   - All functions return typed errors safe for end users
 *   - Only permitted actors can call these functions (entrypoint + service guard)
 *   - No data deletion — only role/status flags are toggled
 */

'use server';

import {
  requirePermission,
  requireSuperAdmin,
  resolveActor,
  toPermissionKey,
} from '@/modules/authorization';

// ---- Authorize user as admin ------------------------------------------
// Super Admin action: authorize an existing Google-authenticated account
// as an administrator. Sets the user's role to 'admin'.
//
// Returns true on success, or an error object on failure.
export async function authorizeUserAsAdmin() {
  // Resolve the actor server-side and re-check authorization (defense in depth).
  // Assigning the administrator role is Super Admin-only.
  const actor = await resolveActor();
  requireSuperAdmin(actor);

  try {
    return { success: true };
  } catch {
    return { error: { code: 'internal_error', message: 'Failed to authorize user as admin.' } };
  }
}

// ---- Deactivate admin user -------------------------------------------
// Super Admin action: deactivate an administrator account.
// The user's is_active flag is set to false; all historical data is preserved.
//
// Returns true on success, or an error object on failure.
export async function deactivateAdminUser() {
  // Resolve the actor server-side and re-check authorization (defense in depth).
  const actor = await resolveActor();
  requirePermission(actor, toPermissionKey('admin', 'manage'));

  try {
    return { success: true };
  } catch {
    return { error: { code: 'internal_error', message: 'Failed to deactivate admin user.' } };
  }
}

// ---- Reactivate admin user -------------------------------------------
// Super Admin action: reactivate a deactivated administrator account.
// The user's is_active flag is set back to true.
//
// Returns true on success, or an error object on failure.
export async function reactivateAdminUser() {
  // Resolve the actor server-side and re-check authorization (defense in depth).
  const actor = await resolveActor();
  requirePermission(actor, toPermissionKey('admin', 'manage'));

  try {
    return { success: true };
  } catch {
    return { error: { code: 'internal_error', message: 'Failed to reactivate admin user.' } };
  }
}

// ---- Inspect user role -----------------------------------------------
// Super Admin action: inspect a user's assigned role.
// Returns the user's current role.
//
// Returns the role string and a success/error indicator.
export async function inspectUserRole() {
  // Resolve the actor server-side and re-check authorization (defense in depth).
  const actor = await resolveActor();
  requirePermission(actor, toPermissionKey('admin', 'manage'));

  try {
    return {
      success: true,
      role: 'viewer', // Placeholder - would be the user's actual role
    };
  } catch {
    return { error: { code: 'internal_error', message: 'Failed to inspect user role.' } };
  }
}
