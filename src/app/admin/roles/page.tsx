import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { RoleManager } from '@/components/admin/roles/role-manager';
import { ALL_PERMISSION_KEYS, PERMISSIONS } from '@/modules/authorization';
import type {
  AdminPermissionOption,
  AdminRoleView,
} from '@/lib/contracts/admin-authorization';
import { listRolesForAdmin } from '@/workflows/admin/roles';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/roles';

/**
 * Role and permission administration.
 *
 * The surface is Super-Admin-only (D-025): a role can grant or remove
 * privileges, so it cannot be delegated to a custom role. The page refuses
 * before it reads anything, and the workflow checks the actor again.
 */
export default async function AdminRolesPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  if (!actor.isSuperAdmin) {
    notFound();
  }

  const roles = await listRolesForAdmin(actor);

  // The catalog is the single source of truth for what can be granted, so the
  // editor offers exactly the permissions the server will accept.
  const permissions: readonly AdminPermissionOption[] = ALL_PERMISSION_KEYS.map(key => ({
    key,
    resource: PERMISSIONS[key].resource,
    action: PERMISSIONS[key].action,
    description: PERMISSIONS[key].description,
  }));

  const roleViews: readonly AdminRoleView[] = roles.map(role => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map(permission => ({
      permissionKey: permission.permissionKey,
      granted: permission.granted,
    })),
    grantedPermissionKeys: role.grantedPermissionKeys,
    userCount: role.userCount,
    createdAt: role.createdAt,
  }));

  return <RoleManager initialRoles={roleViews} permissions={permissions} />;
}
