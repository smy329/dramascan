/**
 * Canonical RBAC permission catalog (owned by the `authorization` module).
 *
 * This module is the **single source of truth** for authorization in the
 * DramaScan application. Every permission that can be granted to a role is
 * identified by a canonical `resource.action` key (dotted form), for example
 * `drama.update` or `episode.read`.
 *
 * Rules:
 * - The catalog keys are the canonical permission identifiers. Nothing outside
 *   this module may define or extend the catalog.
 * - Keys use the `${resource}.${action}` form; both segments are lowercase
 *   snake_case strings.
 * - The catalog is the only place permission identifiers are declared. Guards,
 *   workflows, and services resolve permissions through this module — they never
 *   invent local permission strings.
 * - Super Admin resolves to the complete catalog centrally via
 *   `SUPER_ADMIN_PERMISSION_KEYS`. No code special-cases a role name.
 */

// ---- Permission dimensions -------------------------------------------------

export const PERMISSION_RESOURCES = [
  'drama',
  'movie',
  'episode',
  'season',   // Added
  'category',
  'platform',
  'user',
  'review',
  'rating',
  'analytics',
  'settings',
  'admin',
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

// ---- Canonical permission catalog ------------------------------------------

export const PERMISSIONS = {
  // Content: drama
  'drama.create': { resource: 'drama', action: 'create', description: 'Create dramas.' },
  'drama.read': { resource: 'drama', action: 'read', description: 'Read dramas.' },
  'drama.update': { resource: 'drama', action: 'update', description: 'Update dramas.' },
  'drama.delete': { resource: 'drama', action: 'delete', description: 'Delete dramas.' },
  'drama.manage': { resource: 'drama', action: 'manage', description: 'Manage dramas.' },

  // Content: movie
  'movie.create': { resource: 'movie', action: 'create', description: 'Create movies.' },
  'movie.read': { resource: 'movie', action: 'read', description: 'Read movies.' },
  'movie.update': { resource: 'movie', action: 'update', description: 'Update movies.' },
  'movie.delete': { resource: 'movie', action: 'delete', description: 'Delete movies.' },
  'movie.manage': { resource: 'movie', action: 'manage', description: 'Manage movies.' },

  // Content: episode
  'episode.create': { resource: 'episode', action: 'create', description: 'Create episodes.' },
  'episode.read': { resource: 'episode', action: 'read', description: 'Read episodes.' },
  'episode.update': { resource: 'episode', action: 'update', description: 'Update episodes.' },
  'episode.delete': { resource: 'episode', action: 'delete', description: 'Delete episodes.' },
  'episode.manage': { resource: 'episode', action: 'manage', description: 'Manage episodes.' },

  // Content: season
  'season.read': { resource: 'season', action: 'read', description: 'Read seasons.' },
  'season.create': { resource: 'season', action: 'create', description: 'Create seasons.' },
  'season.update': { resource: 'season', action: 'update', description: 'Update seasons.' },
  'season.delete': { resource: 'season', action: 'delete', description: 'Delete seasons.' },

  // Content: category
  'category.create': { resource: 'category', action: 'create', description: 'Create categories.' },
  'category.read': { resource: 'category', action: 'read', description: 'Read categories.' },
  'category.update': { resource: 'category', action: 'update', description: 'Update categories.' },
  'category.delete': { resource: 'category', action: 'delete', description: 'Delete categories.' },
  'category.manage': { resource: 'category', action: 'manage', description: 'Manage categories.' },

  // Content: platform
  'platform.create': { resource: 'platform', action: 'create', description: 'Create platforms.' },
  'platform.read': { resource: 'platform', action: 'read', description: 'Read platforms.' },
  'platform.update': { resource: 'platform', action: 'update', description: 'Update platforms.' },
  'platform.delete': { resource: 'platform', action: 'delete', description: 'Delete platforms.' },
  'platform.manage': { resource: 'platform', action: 'manage', description: 'Manage platforms.' },

  // User administration
  'user.read': { resource: 'user', action: 'read', description: 'Read user accounts.' },
  'user.manage': { resource: 'user', action: 'manage', description: 'Manage user accounts.' },

  // Reviews
  'review.create': { resource: 'review', action: 'create', description: 'Create reviews.' },
  'review.read': { resource: 'review', action: 'read', description: 'Read reviews.' },
  'review.delete': { resource: 'review', action: 'delete', description: 'Delete reviews.' },
  'review.manage': { resource: 'review', action: 'manage', description: 'Manage reviews.' },

  // Ratings
  'rating.read': { resource: 'rating', action: 'read', description: 'Read ratings.' },
  'rating.manage': { resource: 'rating', action: 'manage', description: 'Manage ratings.' },

  // Analytics
  'analytics.read': { resource: 'analytics', action: 'read', description: 'Read analytics.' },
  'analytics.manage': { resource: 'analytics', action: 'manage', description: 'Manage analytics.' },

  // Platform settings
  'settings.read': { resource: 'settings', action: 'read', description: 'Read settings.' },
  'settings.manage': { resource: 'settings', action: 'manage', description: 'Manage settings.' },

  // Administration
  'admin.manage': { resource: 'admin', action: 'manage', description: 'Manage administration.' },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export type PermissionDefinition = (typeof PERMISSIONS)[PermissionKey];

// ---- Catalog helpers --------------------------------------------------------

/** All canonical permission keys in the catalog. */
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Permission keys assigned to Super Admin — the complete catalog. */
export const SUPER_ADMIN_PERMISSION_KEYS: readonly PermissionKey[] = [...ALL_PERMISSION_KEYS];

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set<string>(ALL_PERMISSION_KEYS);

/** Type guard: is the value a canonical permission key? */
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
}

/**
 * Compose a canonical `resource.action` permission key.
 *
 * The composed key is the single canonical identifier for a permission; it must
 * exist in the catalog (see `isPermissionKey`).
 */
export function toPermissionKey(resource: PermissionResource, action: PermissionAction): PermissionKey {
  const key = `${resource}.${action}` as PermissionKey;
  if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, key)) {
    throw new Error(`Unknown permission key: ${key}`);
  }
  return key;
}
