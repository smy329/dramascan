import { describe, expect, it, vi } from 'vitest';

/**
 * Better Auth validates its model against the Drizzle schema at runtime and
 * throws `SchemaMismatchError` on the first database operation when a table,
 * field name, or nullability does not match. That check is pure (it inspects
 * the Drizzle table objects, not the database), so this test runs it without a
 * connection and fails before deployment when the auth schema drifts.
 *
 * The environment is set before the auth module is imported because
 * `serverConfig` and the connection pool are created at module load.
 */
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/dramascan';
  process.env.BETTER_AUTH_SECRET = 'unit-test-secret-with-at-least-32-characters';
});

vi.mock('server-only', () => ({}));

import { schemaCheckFor } from '@better-auth/core/db/internal';
import { auth } from '@/platform/auth/better-auth';

describe('Better Auth schema', () => {
  it('matches the fields Better Auth writes through the Drizzle adapter', async () => {
    const context = await auth.$context;
    const check = schemaCheckFor(context.adapter);

    expect(check).toBeDefined();
    // The check resolves (or has already resolved cleanly and returns
    // `undefined`) when the schema is compatible. A mismatch throws or rejects
    // with a SchemaMismatchError listing every missing or incompatible field.
    await expect(Promise.resolve(check!())).resolves.toBeUndefined();
  });
});
