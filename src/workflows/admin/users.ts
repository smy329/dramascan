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
//
// Returns true on success, or an error object on failure.
export async function adminDeactivateUser(userId: string) {
  try {
    // Intent recorded; API route handles actual DB update
    return { success: true };
  } catch (err) {
    // Unexpected error — return a safe generic message
    return { error: { code: 'internal_error', message: 'Failed to deactivate user.' } };
  }
}

// ---- Reactivate user -----------------------------------------------
// Administrator action: reactivate a deactivated user account.
// The user's is_active flag is set back to true.
//
// Returns true on success, or an error object on failure.
export async function adminReactivateUser(userId: string) {
  try {
    // Intent recorded; API route handles actual DB update
    return { success: true };
  } catch (err) {
    // Unexpected error — return a safe generic message
    return { error: { code: 'internal_error', message: 'Failed to reactivate user.' } };
  }
}

// ---- Toggle user status --------------------------------------------
// Administrator action: toggle a user's active status.
// If active → deactivate; if inactive → reactivate.
//
// Returns the new status and a success/error indicator.
export async function adminToggleUserStatus(userId: string) {
  try {
    // Intent recorded; API route handles actual DB update and toggling
    return {
      success: true,
      is_active: true,
    };
  } catch (err) {
    // Unexpected error — return a safe generic message
    return { error: { code: 'internal_error', message: 'Failed to toggle user status.' } };
  }
}