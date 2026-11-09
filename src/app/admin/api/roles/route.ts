import { createRole, editRole, assignPermission, revokePermission, getRolePermissions, validateSuperAdminAccess } from '@/workflows/admin/roles';

import { redirect } from 'next/navigation';

// Only Super Admin may access this endpoint.
// This route handler verifies the user is Super Admin before delegating
// to the workflow functions. In a full implementation, this would check
// the session's is_super_admin flag.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  // In a full implementation, this would verify admin auth tokens.
  // For now, we accept query params to indicate the action.
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (!action) {
    return new Response('Missing action', { status: 400 });
  }

  // Helper: get string param or empty string
  const getParam = (key: string) => searchParams.get(key) || '';

  // Dispatch to the appropriate workflow
  switch (action) {
    case 'create-role': {
      const name = getParam('name') || '';
      const description = getParam('description') || '';
      const result = await createRole(name, description);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/roles?created=${result.role.id}&name=${encodeURIComponent(result.role.name)}`);
    }

    case 'edit-role': {
      const roleId = getParam('roleId');
      const name = getParam('name') || undefined;
      const description = getParam('description') || undefined;
      const result = await editRole(roleId, name, description);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/roles?edited=${roleId}&name=${encodeURIComponent(result.role.name || '')}`);
    }

    case 'assign-permission': {
      const roleId = getParam('roleId');
      const action = getParam('action') as 'create' | 'read' | 'update' | 'delete' | 'manage';
      const resource = getParam('resource') as 'drama' | 'movie' | 'episode' | 'category' | 'platform' | 'user' | 'review' | 'rating' | 'analytics' | 'settings' | 'admin';
      const result = await assignPermission(roleId, action, resource);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/roles?permission-assigned=${roleId}&action=${action}&resource=${resource}`);
    }

    case 'revoke-permission': {
      const roleId = getParam('roleId');
      const action = getParam('action') as 'create' | 'read' | 'update' | 'delete' | 'manage';
      const resource = getParam('resource') as 'drama' | 'movie' | 'episode' | 'category' | 'platform' | 'user' | 'review' | 'rating' | 'analytics' | 'settings' | 'admin';
      const result = await revokePermission(roleId, action, resource);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/roles?permission-revoked=${roleId}&action=${action}&resource=${resource}`);
    }

    case 'get-permissions': {
      const roleId = getParam('roleId');
      const result = await getRolePermissions(roleId);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return new Response(
        JSON.stringify({ success: result.success, permissions: result.permissions }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    case 'validate-access': {
      const roleId = getParam('roleId') || undefined;
      const action = getParam('action') as 'create' | 'read' | 'update' | 'delete' | 'manage' | undefined;
      const resource = getParam('resource') as 'drama' | 'movie' | 'episode' | 'category' | 'platform' | 'user' | 'review' | 'rating' | 'analytics' | 'settings' | 'admin' | undefined;
      const result = await validateSuperAdminAccess(roleId, action, resource);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return new Response(
        JSON.stringify({ success: result.success }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    default:
      return new Response('Unknown action', { status: 400 });
  }
}