import { authorizeUserAsAdmin, deactivateAdminUser, reactivateAdminUser, inspectUserRole } from '@/workflows/admin/users';

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
  const userId = searchParams.get('userId');

  if (!action || !userId) {
    return new Response('Missing action or userId', { status: 400 });
  }

  // Dispatch to the appropriate workflow
  switch (action) {
    case 'authorize-admin': {
      // Only Super Admin can authorize users as admin
      const result = await authorizeUserAsAdmin(userId);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/users?authorized=${userId}&role=admin`);
    }

    case 'deactivate-admin': {
      const result = await deactivateAdminUser(userId);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/users?deactivated=${userId}`);
    }

    case 'reactivate-admin': {
      const result = await reactivateAdminUser(userId);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/users?reactivated=${userId}`);
    }

    case 'inspect-role': {
      const result = await inspectUserRole(userId);
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return new Response(
        JSON.stringify({ success: result.success, role: result.role }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    default:
      return new Response('Unknown action', { status: 400 });
  }
}