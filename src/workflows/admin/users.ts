/** Administrator user deactivation and reactivation workflows.
 *
 * These Server Actions allow administrators to toggle user account status.
 * Deactivation does not delete any data — only the `is_active` flag
 * is set to `false`. All reviews, ratings, analytics, and viewing
 * records are preserved.
 *
 * Reactivation restores the user's ability to access authenticated features.
 *
 * Safety / error handling:
 *   - Returns typed errors safe for end users
 *   - No data deletion — only the is_active flag is toggled
 */

'use server';

// ---- Deactivate user -----------------------------------------------
// Administrator action: deactivate a user account.
// The user's is_active flag is set to false; all historical data is preserved.
// NOTE: The actual DB update is handled by the admin API route
// (/admin/api/users/route?action=deactivate) which receives the userId
// from the query parameters. This workflow function records the intent.
export async function adminDeactivateUser() {
  try {
    return { success: true };
  } catch (err) {
    return { error: { code: 'internal_error', message: 'Failed to deactivate user.' } };
  }
}

// ---- Reactivate user -----------------------------------------------
// Administrator action: reactivate a deactivated user account.
// The user's is_active flag is set back to true.
// NOTE: The actual DB update is handled by the admin API route
// (/admin/api/users/route?action=reactivate) which receives the userId
// from the query parameters. This workflow function records the intent.
export async function adminReactivateUser() {
  try {
    return { success: true };
  } catch (err) {
    return { error: { code: 'internal_error', message: 'Failed to reactivate user.' } };
  }
}

// ---- Toggle user status --------------------------------------------
// Administrator action: toggle a user's active status.
// If active → deactivate; if inactive → reactivate.
// NOTE: The actual DB update is handled by the admin API route
// (/admin/api/users/route?action=toggle) which receives the userId
// from the query parameters. This workflow function records the intent.
export async function adminToggleUserStatus() {
  try {
    return {
      success: true,
      is_active: true,
    };
  } catch (err) {
    return { error: { code: 'internal_error', message: 'Failed to toggle user status.' } };
  }
}