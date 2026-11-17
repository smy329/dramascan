/**
 * Client-safe contracts for the administration role and user controls.
 *
 * The domain modules own the server-side types, but a client island cannot
 * import a module that pulls in the database. These shapes are the explicit
 * boundary between the server page and the browser: the page maps the module
 * result onto them, and the island only ever sees them.
 *
 * The permission key stays a plain string here. The catalog is the
 * single source of truth on the server, and the API rejects an unknown key,
 * so the browser does not need a second copy of the catalog.
 */

/** One stored permission row of a role. */
export type AdminRolePermissionView = {
  permissionKey: string;
  granted: boolean;
};

/** One role, as the administration page renders it. */
export type AdminRoleView = {
  id: string;
  name: string;
  description: string | null;
  permissions: readonly AdminRolePermissionView[];
  grantedPermissionKeys: readonly string[];
  userCount: number;
  createdAt: string;
};

/** One grantable permission from the canonical catalog. */
export type AdminPermissionOption = {
  key: string;
  resource: string;
  action: string;
  description: string;
};

/** One role assignment shown next to a listed account. */
export type AdminUserRoleView = {
  roleId: string;
  roleName: string;
  assignedAt: string;
};

/** A role an account can be assigned to. */
export type AdminAssignableRoleView = {
  id: string;
  name: string;
};
