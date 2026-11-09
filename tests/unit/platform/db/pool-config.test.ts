import { describe, expect, it } from 'vitest';
import {
  DATABASE_POOL_LIMITS,
  createPoolConfig,
  describeDatabaseError,
} from '@/platform/db/pool-config';

const DATABASE_URL = 'postgresql://dramascan_app:dummy-secret@localhost:5432/dramascan';

describe('createPoolConfig', () => {
  it('uses conservative, explicit pool limits and timeouts', () => {
    const config = createPoolConfig(DATABASE_URL);

    expect(config.connectionString).toBe(DATABASE_URL);
    expect(config.application_name).toBe('dramascan');
    expect(config.max).toBe(DATABASE_POOL_LIMITS.max);
    expect(config.min).toBe(0);
    expect(config.max).toBeLessThanOrEqual(10);
    expect(config.connectionTimeoutMillis).toBe(DATABASE_POOL_LIMITS.connectionTimeoutMillis);
    expect(config.idleTimeoutMillis).toBe(DATABASE_POOL_LIMITS.idleTimeoutMillis);
    expect(config.maxLifetimeSeconds).toBe(DATABASE_POOL_LIMITS.maxLifetimeSeconds);
    expect(config.maxUses).toBe(DATABASE_POOL_LIMITS.maxUses);
    expect(config.statement_timeout).toBe(DATABASE_POOL_LIMITS.statementTimeoutMillis);
    expect(config.query_timeout).toBe(DATABASE_POOL_LIMITS.queryTimeoutMillis);
    expect(config.idle_in_transaction_session_timeout).toBe(
      DATABASE_POOL_LIMITS.idleInTransactionTimeoutMillis
    );
    expect(config.keepAlive).toBe(true);
    expect(config.keepAliveInitialDelayMillis).toBe(
      DATABASE_POOL_LIMITS.keepAliveInitialDelayMillis
    );
    expect(config.allowExitOnIdle).toBe(false);
  });

  it('keeps the limits immutable so runtime configuration cannot drift', () => {
    expect(Object.isFrozen(DATABASE_POOL_LIMITS)).toBe(true);
  });

  it('does not mutate the supplied connection string', () => {
    const config = createPoolConfig(DATABASE_URL);

    expect(config.connectionString).toBe(DATABASE_URL);
  });
});

describe('describeDatabaseError', () => {
  it('redacts connection strings and password fragments from log-safe details', () => {
    const error = Object.assign(
      new Error(`connection failed for ${DATABASE_URL}?password=dummy-secret`),
      { code: 'ECONNREFUSED' }
    );

    const details = describeDatabaseError(error);

    expect(details.name).toBe('Error');
    expect(details.code).toBe('ECONNREFUSED');
    expect(details.message).not.toContain('dummy-secret');
    expect(details.message).toContain('[redacted-database-url]');
  });

  it('returns a safe generic detail for non-Error values', () => {
    const details = describeDatabaseError('unexpected');

    expect(details).toEqual({
      name: 'UnknownError',
      code: null,
      message: 'Non-error value received.',
    });
  });
});
