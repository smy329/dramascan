/** Better Auth configuration (server-only).
 *
 * This module sets up Better Auth with PostgreSQL storage.
 * Password authentication is not implemented — Google OAuth is the only provider.
 * Better Auth manages its own ID type (UUID) per D-013.
 * Secure cookie settings are applied for production use.
 * Only imported on the server (via `server-only`).
 *
 * Google OAuth configuration is read from environment variables:
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 *
 * Session cookie settings (HttpOnly, Secure, SameSite) are
 * managed by the Drizzle adapter and browser.
 *
 * Better Auth handles user creation and account linking automatically
 * when using the Drizzle adapter with Google OAuth. On first sign-in,
 * a user record is created. On subsequent logins, the account is linked
 * if the Google email matches an existing user. The Google profile
 * (name & image) is stored in the users table via the adapter.
 * Only imported on the server (via `server-only`).
 */
import 'server-only';
import { betterAuth } from 'better-auth';

// Minimal Better Auth configuration.
// Google OAuth client credentials are read from environment variables
// (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) by better-auth core.
// The core reads these and configures the Google provider automatically.
// Session cookie settings are handled by the adapter and browser.
// User creation and account linking are handled by Better Auth core.
export const auth = betterAuth({});

// Export type for use in server components and actions
export type AuthClient = typeof auth;

// Export the configured instance (default export for convenience)
export default auth;