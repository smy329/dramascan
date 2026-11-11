import { authorizeUserAsAdmin, deactivateAdminUser, reactivateAdminUser, inspectUserRole } from '@/workflows/admin/users';
import { resolveActor, requirePermission, requireSuperAdmin, toPermissionKey } from '@/modules/authorization';
import { mapErrorToRest } from '@/platform/Http';
import { AppError } from '@/platform/errors';
import { redirect } from 'next/navigation';

// Only permitted actors may access this endpoint.
// Server-side authorization is enforced here via the centralized authorization
// guards; UI hiding is never treated as a boundary.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const requestId = '01J-unknown_request_id';

  try {
    const actor = await resolveActor();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Authorizing an administrator assigns a role, so it is Super Admin-only.
    // Ordinary user management keeps its canonical permission requirement.
    if (action === 'authorize-admin') {
      requireSuperAdmin(actor);
    } else {
      requirePermission(actor, toPermissionKey('admin', 'manage'));
    }

    if (!action) {
      return new Response('Missing action', { status: 400 });
    }

    // Dispatch to the appropriate workflow
    switch (action) {
      case 'authorize-admin': {
        const result = await authorizeUserAsAdmin();
        if (result.error) {
          return new Response(result.error.message, { status: 500 });
        }
        // Note: In a full implementation, we would need the userId from somewhere
        // For now, just redirect with a generic success indicator
        return redirect('/admin/users?authorized=true&role=admin');
      }

      case 'deactivate-admin': {
        const result = await deactivateAdminUser();
        if (result.error) {
          return new Response(result.error.message, { status: 500 });
        }
        return redirect('/admin/users?deactivated=true');
      }

      case 'reactivate-admin': {
        const result = await reactivateAdminUser();
        if (result.error) {
          return new Response(result.error.message, { status: 500 });
        }
        return redirect('/admin/users?reactivated=true');
      }

      case 'inspect-role': {
        const result = await inspectUserRole();
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
  } catch (error) {
    if (error instanceof AppError) {
      const mapped = mapErrorToRest(error, requestId);
      return new Response(JSON.stringify(mapped.body), { status: mapped.status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } });
    }
    throw error;
  }
}
