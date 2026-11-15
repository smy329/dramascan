import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  resolveActorMock,
  requirePermissionMock,
  updatePublicationMock,
  publishContentMock,
  unpublishContentMock,
} = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  requirePermissionMock: vi.fn(),
  updatePublicationMock: vi.fn(),
  publishContentMock: vi.fn(),
  unpublishContentMock: vi.fn(),
}));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  return { ...permissions, ...guards, resolveActor: resolveActorMock, requirePermission: requirePermissionMock };
});

vi.mock('@/workflows/admin/publication', () => ({
  updatePublication: updatePublicationMock,
  publishContent: publishContentMock,
  unpublishContent: unpublishContentMock,
}));

import { AuthorizationError } from '@/platform/errors';
import { POST } from '@/app/admin/api/publication/route';

const managerActor = {
  userId: 'u1',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['content.manage'],
};

function request(body: unknown): Request {
  return new Request('http://localhost:3000/admin/api/publication', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resolveActorMock.mockReset();
  requirePermissionMock.mockReset();
  updatePublicationMock.mockReset();
  publishContentMock.mockReset();
  unpublishContentMock.mockReset();
});

describe('POST /admin/api/publication', () => {
  it('returns 200 with the publication result for an eligible request', async () => {
    resolveActorMock.mockResolvedValue(managerActor);
    requirePermissionMock.mockReturnValue(managerActor);
    publishContentMock.mockResolvedValue({
      contentType: 'drama',
      action: 'publish',
      summary: { requested: 1, succeeded: 1, skipped: 0, failed: 0 },
      results: [{ id: '0198f3a2-0000-7000-8000-000000000001', status: 'succeeded', reason: null }],
    });

    const response = await POST(
      request({ contentType: 'drama', action: 'publish', ids: ['0198f3a2-0000-7000-8000-000000000001'] })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        contentType: 'drama',
        action: 'publish',
        summary: { requested: 1, succeeded: 1, skipped: 0, failed: 0 },
        results: [{ id: '0198f3a2-0000-7000-8000-000000000001', status: 'succeeded', reason: null }],
      },
    });
    expect(publishContentMock).toHaveBeenCalledWith(managerActor, {
      contentType: 'drama',
      action: 'publish',
      ids: ['0198f3a2-0000-7000-8000-000000000001'],
    });
  });

  it('dispatches unpublish through the unpublish workflow', async () => {
    resolveActorMock.mockResolvedValue(managerActor);
    requirePermissionMock.mockReturnValue(managerActor);
    unpublishContentMock.mockResolvedValue({
      contentType: 'episode',
      action: 'unpublish',
      summary: { requested: 1, succeeded: 1, skipped: 0, failed: 0 },
      results: [{ id: '0198f3a2-0000-7000-8000-000000000002', status: 'succeeded', reason: null }],
    });

    const response = await POST(
      request({ contentType: 'episode', action: 'unpublish', ids: ['0198f3a2-0000-7000-8000-000000000002'] })
    );

    expect(response.status).toBe(200);
    expect(unpublishContentMock).toHaveBeenCalled();
  });

  it('returns 400 for a malformed publication request', async () => {
    resolveActorMock.mockResolvedValue(managerActor);
    requirePermissionMock.mockReturnValue(managerActor);

    const response = await POST(request({ contentType: 'category', action: 'publish', ids: ['0198f3a2-0000-7000-8000-000000000003'] }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
    expect(updatePublicationMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the actor lacks the content manage permission', async () => {
    resolveActorMock.mockResolvedValue(managerActor);
    requirePermissionMock.mockImplementation(() => {
      throw new AuthorizationError('Insufficient permissions.');
    });

    const response = await POST(
      request({ contentType: 'drama', action: 'publish', ids: ['0198f3a2-0000-7000-8000-000000000004'] })
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
    expect(updatePublicationMock).not.toHaveBeenCalled();
  });
});
