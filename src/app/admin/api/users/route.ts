import { adminDeactivateUser, adminReactivateUser, adminToggleUserStatus } from '@/workflows/admin/users';

import { redirect } from 'next/navigation';

// Only administrators may access this endpoint.
// This route handler should be protected by admin-only middleware
// in a full implementation; for now we delegate to the
// workflow functions and let the caller handle authorization.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  // In a full implementation, this would verify admin auth tokens.
  // For now, we accept a simple query param to indicate the action.
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');

  if (!action || !userId) {
    return new Response('Missing action or userId', { status: 400 });
  }

  // Dispatch to the appropriate workflow
  switch (action) {
    case 'deactivate': {
      const result = await adminDeactivateUser();
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/users?deactivated=${userId}`);
    }

    case 'reactivate': {
      const result = await adminReactivateUser();
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/users?reactivated=${userId}`);
    }

    case 'toggle': {
      const result = await adminToggleUserStatus();
      if (result.error) {
        return new Response(result.error.message, { status: 500 });
      }
      return redirect(`/admin/users?toggled=${userId}&status=${result.is_active ? 'active' : 'deactivated'}`);
    }

    default:
      return new Response('Unknown action', { status: 400 });
  }
}