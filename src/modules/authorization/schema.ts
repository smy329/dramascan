/**
 * Authorization schema fragment (owned by `authorization`).
 *
 * RBAC tables and the canonical permission catalog for the authorization
 * domain. The canonical permission identifiers are `resource.action` keys
 * (e.g. `drama.update`) owned by `modules/authorization/permissions.ts`.
 *
 * Tables:
 * - `roles` — role definitions (super_admin, content_manager, moderator,
 *   analyst, viewer, plus custom roles created via the Super Admin console).
 * - `user_roles` — many-to-many user ↔ role assignments. A user may hold
 *   multiple roles; effective permissions are the union of all assigned roles.
 * - `permissions` — (action, resource) → granted mappings scoped to a role.
 *
 * Note: the `users`, `accounts`, `sessions`, and `verifications` identity
 * tables remain owned by the `auth` module; authorization consumes them via
 * the auth module public API.
 *
 * Only the `authorization` module may write these tables.
 * `src/db/schema.ts` assembles this namespace; no module may import this file
 * directly.
 */
export {};
