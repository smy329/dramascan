import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The playback heartbeat endpoint.
 *
 * The heartbeat is a beacon: the browser reports the position while the
 * episode plays and has to be able to do so while the page is being closed.
 * `ARCHITECTURE.md` §9.2 allocates beacons to REST with `sendBeacon` or a
 * keepalive `fetch`, and §9.3 names `POST /api/playback/progress` as the
 * endpoint and `workflows/save-playback-progress` as the workflow behind it.
 *
 * The route is a thin adapter: it reads the request, resolves the actor, calls
 * one workflow, and maps the typed error to a status code.
 */

vi.mock('server-only', () => ({}));

const { resolveActorMock, savePlaybackProgressWorkflowMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  savePlaybackProgressWorkflowMock: vi.fn(),
}));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );

  return { ...guards, resolveActor: resolveActorMock };
});

// The users module's public API pulls in the database client, which needs a
// connection string. The route only needs the input contract, so the mock
// exposes the real validator and nothing else.
vi.mock('@/modules/users', async () => {
  const validation = await vi.importActual<typeof import('@/modules/users/validation')>(
    '@/modules/users/validation'
  );

  return { parsePlaybackProgressInput: validation.parsePlaybackProgressInput };
});

vi.mock('@/workflows/playback/save-playback-progress', () => ({
  savePlaybackProgressWorkflow: savePlaybackProgressWorkflowMock,
}));

import { POST } from '@/app/api/playback/progress/route';
import { AuthenticationError, ValidationError } from '@/platform/errors';

const viewer = {
  userId: 'viewer-1',
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/playback/progress', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = {
  episodeId: '11111111-1111-4111-8111-111111111111',
  positionSeconds: 120,
  durationSeconds: 2400,
  watchedAt: '2026-11-23T10:00:00.000Z',
  sourceVersion: 1,
};

beforeEach(() => {
  resolveActorMock.mockReset();
  savePlaybackProgressWorkflowMock.mockReset();
  resolveActorMock.mockResolvedValue(viewer);
  savePlaybackProgressWorkflowMock.mockResolvedValue({
    applied: true,
    positionSeconds: 120,
    durationSeconds: 2400,
    thresholdMet: false,
  });
});

describe('POST /api/playback/progress', () => {
  it('stores the position and answers 200', async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        applied: true,
        positionSeconds: 120,
        durationSeconds: 2400,
        thresholdMet: false,
      },
    });
    expect(savePlaybackProgressWorkflowMock).toHaveBeenCalledWith(viewer, {
      episodeId: validBody.episodeId,
      positionSeconds: 120,
      durationSeconds: 2400,
      watchedAt: new Date(validBody.watchedAt),
      sourceVersion: 1,
    });
  });

  it('answers 400 for a malformed body', async () => {
    const response = await POST(request({ episodeId: 'not-a-uuid' }));

    expect(response.status).toBe(400);
    expect(savePlaybackProgressWorkflowMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/playback/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      })
    );

    expect(response.status).toBe(400);
    expect(savePlaybackProgressWorkflowMock).not.toHaveBeenCalled();
  });

  it('answers 401 when the viewer is not signed in', async () => {
    savePlaybackProgressWorkflowMock.mockRejectedValue(
      new AuthenticationError('Authentication required.')
    );

    const response = await POST(request(validBody));

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('authentication_required');
  });

  it('answers 400 when the payload is rejected by the module', async () => {
    savePlaybackProgressWorkflowMock.mockRejectedValue(
      new ValidationError('Invalid playback progress.', { positionSeconds: ['Out of range.'] })
    );

    const response = await POST(request(validBody));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { fieldErrors?: Record<string, string[]> } };
    expect(body.error.fieldErrors?.positionSeconds).toEqual(['Out of range.']);
  });

  it('rejects a cross-site request', async () => {
    const response = await POST(request(validBody, { 'sec-fetch-site': 'cross-site' }));

    expect(response.status).toBe(403);
    expect(savePlaybackProgressWorkflowMock).not.toHaveBeenCalled();
  });
});
