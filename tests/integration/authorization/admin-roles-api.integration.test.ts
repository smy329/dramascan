import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the administrator role API routes.
 *
 * The routes use the real PostgreSQL test database, the real workflow layer,
 * and the real authorization guards. Only the session resolution is mocked,
 * because a session cannot exist outside a browser.
 *
 * The previous implementation dispatched every mutation from `GET` through an
 * `?action=` query parameter. These tests pin the method-correct contract:
 * `GET` reads, `POST` creates, `PATCH` updates, `DELETE` removes, and `PUT`
 * replaces a permission set.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for role API integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

const { resolveActorMock } = vi.hoisted(() => ({ resolveActorMock: vi.fn() }));

vi.mock('@/modules/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/modules/authorization')>(
    '@/modules/authorization'
  );

  return { ...actual, resolveActor: resolveActorMock };
});

import { inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { permissions, roles, userRoles } from '@/modules/authorization/schema';
import { closePool } from '@/platform/db/pool';

import * as rolesCollectionRoute from '@/app/admin/api/roles/route';
import * as rolesItemRoute from '@/app/admin/api/roles/[id]/route';
import * as rolesPermissionsRoute from '@/app/admin/api/roles/[id]/permissions/route';

const TEST_ROLE_PREFIX = 'it_api_role_';

const superAdmin = {
  userId: 'it-api-role-super-admin',
  roles: [],
  isSuperAdmin: true,
  permissions: [],
};

const adminManager = {
  userId: 'it-api-role-admin-manager',
  roles: [],
  isSuperAdmin: false,
  permissions: ['admin.manage'],
};

const anonymous = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

async function cleanup(): Promise<void> {
  const roleRows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(like(roles.name, `${TEST_ROLE_PREFIX}%`));

  const roleIds = roleRows.map(row => row.id);

  if (roleIds.length > 0) {
    await db.delete(userRoles).where(inArray(userRoles.role_id, roleIds));
    await db.delete(permissions).where(inArray(permissions.role_id, roleIds));
    await db.delete(roles).where(inArray(roles.id, roleIds));
  }
}

function uniqueName(suffix: string): string {
  return `${TEST_ROLE_PREFIX}${suffix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function jsonRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  await cleanup();
  resolveActorMock.mockReset();
  resolveActorMock.mockResolvedValue(superAdmin);
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('GET /admin/api/roles', () => {
  it('returns the role collection in a data envelope', async () => {
    const response = await rolesCollectionRoute.GET(
      new Request('http://localhost:3000/admin/api/roles')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBeTruthy();

    const body = (await response.json()) as { data: unknown[]; meta: { total: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBe(body.data.length);
  });

  it('returns 401 for an anonymous actor', async () => {
    resolveActorMock.mockResolvedValue(anonymous);

    const response = await rolesCollectionRoute.GET(
      new Request('http://localhost:3000/admin/api/roles')
    );

    expect(response.status).toBe(401);
  });

  it('returns 403 for an actor that only holds admin.manage', async () => {
    resolveActorMock.mockResolvedValue(adminManager);

    const response = await rolesCollectionRoute.GET(
      new Request('http://localhost:3000/admin/api/roles')
    );

    expect(response.status).toBe(403);
  });

  it('does not expose a mutation dispatcher on the collection route', () => {
    expect((rolesCollectionRoute as Record<string, unknown>).PUT).toBeUndefined();
    expect((rolesCollectionRoute as Record<string, unknown>).PATCH).toBeUndefined();
    expect((rolesCollectionRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });
});

describe('POST /admin/api/roles', () => {
  it('creates a role and stores it', async () => {
    const name = uniqueName('created');

    const response = await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name })
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as { data: { id: string; name: string } };
    expect(body.data.name).toBe(name);

    const stored = await db.select().from(roles).where(inArray(roles.id, [body.data.id]));
    expect(stored).toHaveLength(1);
  });

  it('returns 400 for an invalid body', async () => {
    const response = await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name: 'Not Snake Case' })
    );

    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const response = await rolesCollectionRoute.POST(
      new Request('http://localhost:3000/admin/api/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      })
    );

    expect(response.status).toBe(400);
  });

  it('returns 409 for a duplicate role name', async () => {
    const name = uniqueName('duplicate');

    await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name })
    );

    const response = await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name })
    );

    expect(response.status).toBe(409);
  });

  it('returns 403 for a cross-origin request', async () => {
    const response = await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name: uniqueName('cross') }, {
        origin: 'https://evil.example.com',
      })
    );

    expect(response.status).toBe(403);
  });

  it('accepts a request that carries the request origin', async () => {
    const response = await rolesCollectionRoute.POST(
      jsonRequest(
        'POST',
        'http://localhost:3000/admin/api/roles',
        { name: uniqueName('same_origin') },
        { origin: 'http://localhost:3000' }
      )
    );

    expect(response.status).toBe(201);
  });
});

describe('PATCH /admin/api/roles/[id]', () => {
  it('renames the role', async () => {
    const created = await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name: uniqueName('before') })
    );
    const { data } = (await created.json()) as { data: { id: string } };

    const response = await rolesItemRoute.PATCH(
      jsonRequest('PATCH', `http://localhost:3000/admin/api/roles/${data.id}`, {
        name: uniqueName('after'),
      }),
      contextFor(data.id)
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { name: string } };
    expect(body.data.name).toContain(TEST_ROLE_PREFIX);
  });

  it('returns 404 for an unknown role', async () => {
    const id = randomUUID();

    const response = await rolesItemRoute.PATCH(
      jsonRequest('PATCH', `http://localhost:3000/admin/api/roles/${id}`, { name: uniqueName('x') }),
      contextFor(id)
    );

    expect(response.status).toBe(404);
  });
});

describe('DELETE /admin/api/roles/[id]', () => {
  it('deletes the role and answers 204 without a body', async () => {
    const created = await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name: uniqueName('deleted') })
    );
    const { data } = (await created.json()) as { data: { id: string } };

    const response = await rolesItemRoute.DELETE(
      new Request(`http://localhost:3000/admin/api/roles/${data.id}`, { method: 'DELETE' }),
      contextFor(data.id)
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(await db.select().from(roles).where(inArray(roles.id, [data.id]))).toHaveLength(0);
  });

  it('returns 404 for an unknown role', async () => {
    const id = randomUUID();

    const response = await rolesItemRoute.DELETE(
      new Request(`http://localhost:3000/admin/api/roles/${id}`, { method: 'DELETE' }),
      contextFor(id)
    );

    expect(response.status).toBe(404);
  });

  it('returns 403 for a cross-origin request', async () => {
    const id = randomUUID();

    const response = await rolesItemRoute.DELETE(
      new Request(`http://localhost:3000/admin/api/roles/${id}`, {
        method: 'DELETE',
        headers: { origin: 'https://evil.example.com' },
      }),
      contextFor(id)
    );

    expect(response.status).toBe(403);
  });
});

describe('PUT /admin/api/roles/[id]/permissions', () => {
  it('replaces the granted permission set', async () => {
    const created = await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name: uniqueName('perms') })
    );
    const { data } = (await created.json()) as { data: { id: string } };

    const response = await rolesPermissionsRoute.PUT(
      jsonRequest('PUT', `http://localhost:3000/admin/api/roles/${data.id}/permissions`, {
        permissionKeys: ['drama.read', 'episode.read'],
      }),
      contextFor(data.id)
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { grantedPermissionKeys: string[] } };
    expect(body.data.grantedPermissionKeys).toEqual(['drama.read', 'episode.read']);
  });

  it('returns 400 for a permission key that is not in the catalog', async () => {
    const created = await rolesCollectionRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/roles', { name: uniqueName('bad_key') })
    );
    const { data } = (await created.json()) as { data: { id: string } };

    const response = await rolesPermissionsRoute.PUT(
      jsonRequest('PUT', `http://localhost:3000/admin/api/roles/${data.id}/permissions`, {
        permissionKeys: ['not-a-real.permission'],
      }),
      contextFor(data.id)
    );

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown role', async () => {
    const id = randomUUID();

    const response = await rolesPermissionsRoute.PUT(
      jsonRequest('PUT', `http://localhost:3000/admin/api/roles/${id}/permissions`, {
        permissionKeys: ['drama.read'],
      }),
      contextFor(id)
    );

    expect(response.status).toBe(404);
  });
});
