import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
} from '@/modules/authorization/permissions';
import {
  permissions,
  roles,
  userRoles,
} from '@/modules/authorization/schema';

describe('authorization schema reconciliation', () => {
  it('defines no duplicate catalog resource/action dimensions', () => {
    expect(new Set(PERMISSION_RESOURCES).size).toBe(PERMISSION_RESOURCES.length);
    expect(new Set(PERMISSION_ACTIONS).size).toBe(PERMISSION_ACTIONS.length);
  });

  it('uniquely identifies roles by name', () => {
    const config = getTableConfig(roles);
    const nameUnique = config.uniqueConstraints.find((constraint) =>
      constraint.columns.some((column) => column.name === 'name')
    );

    expect(nameUnique).toBeDefined();
    expect(nameUnique?.name).toBe('uq_roles_name');
  });

  it('allows one row per role, resource, and action', () => {
    const config = getTableConfig(permissions);
    const tuple = config.uniqueConstraints.find(
      (constraint) => constraint.columns.length === 3
    );

    expect(tuple?.name).toBe('uq_permissions_role_id_resource_action');
    expect(tuple?.columns.map((column) => column.name)).toEqual([
      'role_id',
      'resource',
      'action',
    ]);
  });

  it('constrains stored pairs to the exact canonical catalog keys', () => {
    const config = getTableConfig(permissions);
    const names = config.checks.map((constraint) => constraint.name);

    expect(names).toEqual(['ck_permissions_permission_key']);
  });

  it('references roles from permissions and user assignments', () => {
    const permissionForeignKey = getTableConfig(permissions).foreignKeys[0];
    const userRoleForeignKey = getTableConfig(userRoles).foreignKeys[0];

    expect(permissionForeignKey?.reference().columns.map((column) => column.name)).toEqual([
      'role_id',
    ]);
    expect(userRoleForeignKey?.reference().columns.map((column) => column.name)).toEqual([
      'role_id',
    ]);
  });

  it('prevents duplicate role assignments and indexes reverse lookups', () => {
    const config = getTableConfig(userRoles);
    const assignmentUnique = config.uniqueConstraints.find(
      (constraint) => constraint.columns.length === 2
    );
    const roleIndex = config.indexes.find((index) =>
      index.config.columns.some((column) => 'name' in column && column.name === 'role_id')
    );

    expect(assignmentUnique?.name).toBe('uq_user_roles_user_id_role_id');
    expect(roleIndex?.config.name).toBe('idx_user_roles_role_id');
  });
});
