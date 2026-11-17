import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the administrator user API routes.
 *
 * The routes use the real PostgreSQL test database, the real workflow layer,
 * and the real authorization guards. Only the session resolution is mocked.
 *
 * The previous implementation dispatched every mutation from `GET` through an
 * `?action=` query parameter on `/admin/api/users`. These tests pin the
 * method-correct contract and the absence of that dispatcher.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for user API integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

const { resolveActorMock } = vi.hoisted(() => ({ resolveActorMock: vi.fn() }));

vi.mock('@/modules/authorization', async () => {
  const actual =
    await vi.importActual<typeof import('@/modules/authorization')>('@/modules/authorization');

  return { ...actual, resolveActor: resolveActorMock };
});

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { permissions, roles, userRoles } from '@/modules/authorization/schema';
import { closePool } from '@/platform/db/pool';

import * as userRolesRoute from '@/app/admin/api/users/[id]/roles/route';
import * as userRoleItemRoute from '@/app/admin/api/users/[id]/roles/[roleId]/route';
import * as userStatusRoute from '@/app/admin/api/users/[id]/status/route';

const TEST_ROLE_PREFIX = 'it_api_urole_';
const TEST_USER_PREFIX = 'it-api-user-';

const superAdmin = {
  userId: 'it-api-user-super-admin',
  roles: [],
  isSuperAdmin: true,
  permissions: [],
};

const adminManager = {
  userId: 'it-api-user-admin-manager',
  roles: [],
  isSuperAdmin: false,
  permissions: ['admin.manage'],
};

const userReader = {
  userId: 'it-api-user-reader',
  roles: [],
  isSuperAdmin: false,
  permissions: ['user.read'],
};

const anonymous = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

async function insertTestUser(options: {
  name: string;
  isActive?: boolean;
  isSuperAdmin?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name: options.name,
      email: `${TEST_USER_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 12)}@example.com`,
      isActive: options.isActive ?? true,
      isSuperAdmin: options.isSuperAdmin ?? false,
    })
    .returning({ id: users.id });

  if (!row) {
    throw new Error('Test user insert returned no row.');
  }

  return row.id;
}

async function insertTestRole(): Promise<string> {
  const [row] = await db
    .insert(roles)
    .values({
      name: `${TEST_ROLE_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    })
    .returning({ id: roles.id });

  if (!row) {
    throw new Error('Test role insert returned no row.');
  }

  return row.id;
}

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

  await db.delete(users).where(like(users.email, `${TEST_USER_PREFIX}%`));
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

describe('the removed GET mutation dispatcher', () => {
  it('no longer exists', () => {
    const routePath = join(process.cwd(), 'src', 'app', 'admin', 'api', 'users', 'route.ts');

    expect(existsSync(routePath)).toBe(false);
  });
});

describe('GET /admin/api/users/[id]/roles', () => {
  it('returns the assignments in a data envelope', async () => {
    resolveActorMock.mockResolvedValue(adminManager);
    const userId = await insertTestUser({ name: 'Role Reader' });

    const response = await userRolesRoute.GET(
      new Request(`http://localhost:3000/admin/api/users/${userId}/roles`),
      contextFor(userId)
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: unknown[]; meta: { total: number } };
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it('returns 401 for an anonymous actor', async () => {
    resolveActorMock.mockResolvedValue(anonymous);
    const userId = await insertTestUser({ name: 'Anonymous Reader' });

    const response = await userRolesRoute.GET(
      new Request(`http://localhost:3000/admin/api/users/${userId}/roles`),
      contextFor(userId)
    );

    expect(response.status).toBe(401);
  });

  it('returns 403 for an actor that only holds user.read', async () => {
    resolveActorMock.mockResolvedValue(userReader);
    const userId = await insertTestUser({ name: 'Read Only Actor' });

    const response = await userRolesRoute.GET(
      new Request(`http://localhost:3000/admin/api/users/${userId}/roles`),
      contextFor(userId)
    );

    expect(response.status).toBe(403);
  });

  it('returns 400 for a malformed user id instead of a database error', async () => {
    resolveActorMock.mockResolvedValue(adminManager);

    const response = await userRolesRoute.GET(
      new Request('http://localhost:3000/admin/api/users/not-a-uuid/roles'),
      contextFor('not-a-uuid')
    );

    expect(response.status).toBe(400);
  });
});

describe('POST /admin/api/users/[id]/roles', () => {
  it('assigns the role and stores the assignment', async () => {
    const userId = await insertTestUser({ name: 'Assignment Target' });
    const roleId = await insertTestRole();

    const response = await userRolesRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${userId}/roles`, { roleId }),
      contextFor(userId)
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { roleId: string }[] };
    expect(body.data.map(item => item.roleId)).toContain(roleId);

    const stored = await db.select().from(userRoles).where(eq(userRoles.user_id, userId));
    expect(stored).toHaveLength(1);
  });

  it('returns 403 for an actor that is not a Super Admin', async () => {
    resolveActorMock.mockResolvedValue(adminManager);
    const userId = await insertTestUser({ name: 'Forbidden Target' });
    const roleId = await insertTestRole();

    const response = await userRolesRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${userId}/roles`, { roleId }),
      contextFor(userId)
    );

    expect(response.status).toBe(403);
  });

  it('returns 404 for an unknown role', async () => {
    const userId = await insertTestUser({ name: 'Unknown Role Target' });

    const response = await userRolesRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${userId}/roles`, {
        roleId: randomUUID(),
      }),
      contextFor(userId)
    );

    expect(response.status).toBe(404);
  });

  it('returns 400 for an invalid body', async () => {
    const userId = await insertTestUser({ name: 'Invalid Body Target' });

    const response = await userRolesRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${userId}/roles`, {
        roleId: 'not-a-uuid',
      }),
      contextFor(userId)
    );

    expect(response.status).toBe(400);
  });

  it('returns 403 for a cross-origin request', async () => {
    const userId = await insertTestUser({ name: 'Cross Origin Target' });
    const roleId = await insertTestRole();

    const response = await userRolesRoute.POST(
      jsonRequest(
        'POST',
        `http://localhost:3000/admin/api/users/${userId}/roles`,
        { roleId },
        { origin: 'https://evil.example.com' }
      ),
      contextFor(userId)
    );

    expect(response.status).toBe(403);
  });
});

describe('DELETE /admin/api/users/[id]/roles/[roleId]', () => {
  it('revokes the assignment and answers 204 without a body', async () => {
    const userId = await insertTestUser({ name: 'Revoke Target' });
    const roleId = await insertTestRole();

    await db.insert(userRoles).values({ user_id: userId, role_id: roleId });

    const response = await userRoleItemRoute.DELETE(
      new Request(`http://localhost:3000/admin/api/users/${userId}/roles/${roleId}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: userId, roleId }) }
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(await db.select().from(userRoles).where(eq(userRoles.user_id, userId))).toHaveLength(0);
  });

  it('returns 404 for a missing assignment', async () => {
    const userId = await insertTestUser({ name: 'No Assignment Target' });
    const roleId = await insertTestRole();

    const response = await userRoleItemRoute.DELETE(
      new Request(`http://localhost:3000/admin/api/users/${userId}/roles/${roleId}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: userId, roleId }) }
    );

    expect(response.status).toBe(404);
  });
});

describe('POST /admin/api/users/[id]/status', () => {
  it('deactivates the account', async () => {
    resolveActorMock.mockResolvedValue(adminManager);
    const userId = await insertTestUser({ name: 'Status Target' });

    const response = await userStatusRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${userId}/status`, {
        isActive: false,
      }),
      contextFor(userId)
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { isActive: boolean } };
    expect(body.data.isActive).toBe(false);
  });

  it('returns 409 when it would remove the last active Super Admin', async () => {
    const userId = await insertTestUser({ name: 'Last Root', isSuperAdmin: true });

    const response = await userStatusRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${userId}/status`, {
        isActive: false,
      }),
      contextFor(userId)
    );

    expect(response.status).toBe(409);
  });

  it('returns 403 when a non-Super-Admin changes a Super Admin account', async () => {
    resolveActorMock.mockResolvedValue(adminManager);
    const userId = await insertTestUser({ name: 'Root Target', isSuperAdmin: true });

    const response = await userStatusRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${userId}/status`, {
        isActive: false,
      }),
      contextFor(userId)
    );

    expect(response.status).toBe(403);
  });

  it('returns 404 for an unknown account', async () => {
    const id = randomUUID();

    const response = await userStatusRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${id}/status`, {
        isActive: false,
      }),
      contextFor(id)
    );

    expect(response.status).toBe(404);
  });

  it('returns 400 for an invalid body', async () => {
    const userId = await insertTestUser({ name: 'Invalid Status Target' });

    const response = await userStatusRoute.POST(
      jsonRequest('POST', `http://localhost:3000/admin/api/users/${userId}/status`, {
        isActive: 'maybe',
      }),
      contextFor(userId)
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 for a malformed account id instead of a database error', async () => {
    resolveActorMock.mockResolvedValue(adminManager);

    const response = await userStatusRoute.POST(
      jsonRequest('POST', 'http://localhost:3000/admin/api/users/not-a-uuid/status', {
        isActive: false,
      }),
      contextFor('not-a-uuid')
    );

    expect(response.status).toBe(400);
  });

  it('returns 403 for a cross-origin request', async () => {
    resolveActorMock.mockResolvedValue(adminManager);
    const userId = await insertTestUser({ name: 'Cross Origin Status Target' });

    const response = await userStatusRoute.POST(
      jsonRequest(
        'POST',
        `http://localhost:3000/admin/api/users/${userId}/status`,
        { isActive: false },
        { origin: 'https://evil.example.com' }
      ),
      contextFor(userId)
    );

    expect(response.status).toBe(403);
  });
});
