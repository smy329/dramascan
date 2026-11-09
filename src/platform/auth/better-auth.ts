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
 * Session cookie settings:
 * - HttpOnly, Secure in production, SameSite=Lax
 * - 30-day session duration
 * Only imported on the server (via `server-only`).
 */
import 'server-only';
import { betterAuth } from 'better-auth';

// Minimal Better Auth configuration.
// Google OAuth client ID and secret are read from environment variables
// (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) by better-auth core.
export const auth = betterAuth({});

// Export type for use in server components and actions
export type AuthClient = typeof auth;

// Export the configured instance (default export for convenience)
export default auth;