import { z } from 'zod';

import { ValidationError } from '@/platform/errors';

import { ALL_PERMISSION_KEYS, isPermissionKey, type PermissionKey } from './permissions';

/**
 * Validation contracts for role and permission administration.
 *
 * Role names are stored identifiers, not labels: lowercase snake_case, so a
 * name can be used in code and in a URL without an escaping rule.
 *
 * `super_admin` is reserved. Super Admin is the authoritative `is_super_admin`
 * flag on the account, not a role grant, so a role with that name would look
 * authoritative while granting nothing.
 */

export const RESERVED_ROLE_NAMES = ['super_admin'] as const;

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export const roleNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(ROLE_NAME_PATTERN, 'Role name must be lowercase snake_case.')
  .refine(name => !(RESERVED_ROLE_NAMES as readonly string[]).includes(name), {
    message: 'This role name is reserved.',
  });

export const roleDescriptionSchema = z.string().trim().max(500).nullable();

export const roleIdSchema = z.uuid();

export const userIdSchema = z.uuid();

export const createRoleSchema = z.strictObject({
  name: roleNameSchema,
  description: roleDescriptionSchema.optional(),
});

export const updateRoleSchema = z
  .strictObject({
    name: roleNameSchema.optional(),
    description: roleDescriptionSchema.optional(),
  })
  .refine(value => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  });

/**
 * A canonical permission key.
 *
 * The catalog is the only source of truth, so an unknown key is rejected at the
 * boundary instead of reaching the database CHECK constraint.
 */
export const permissionKeySchema = z.custom<PermissionKey>(
  value => isPermissionKey(value),
  { message: 'Unknown permission key.' }
);

export const setRolePermissionsSchema = z.strictObject({
  permissionKeys: z.array(permissionKeySchema).max(ALL_PERMISSION_KEYS.length),
});

export const assignUserRoleSchema = z.strictObject({
  roleId: roleIdSchema,
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type AssignUserRoleInput = z.infer<typeof assignUserRoleSchema>;

/**
 * Parse the permission-set request body into canonical permission keys.
 *
 * The route adapter uses this so the body shape and the catalog membership are
 * checked in one place. The service validates the keys again, so a caller that
 * skips this helper still cannot store an unknown permission.
 */
export function parsePermissionKeysBody(input: unknown): PermissionKey[] {
  const parsed = parseOrThrow(setRolePermissionsSchema, input);

  return parsed.permissionKeys;
}

/**
 * Parse untrusted input, throwing the REST-safe validation error the API layer
 * maps to a 400 response with per-field messages.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : 'form';
      (fieldErrors[field] ??= []).push(issue.message);
    }

    throw new ValidationError('The request contains invalid fields.', fieldErrors);
  }

  return parsed.data;
}
