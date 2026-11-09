import 'server-only';

import { Pool } from 'pg';
import { ConfigurationError, serverConfig } from '@/platform/config';
import logger from '@/platform/logging';
import { createPoolConfig, describeDatabaseError } from './pool-config';

/**
 * The application owns exactly one PostgreSQL connection pool.
 *
 * `pg` reconnects lazily: a failed or retired connection is removed from the
 * pool and a new one is created on the next checkout. There is no retry loop
 * and no persistent background worker.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool !== null) {
    return pool;
  }

  if (serverConfig.databaseUrl === null) {
    throw new ConfigurationError([
      'DATABASE_URL is required to initialize the PostgreSQL connection pool.',
    ]);
  }

  const nextPool = new Pool(createPoolConfig(serverConfig.databaseUrl));

  // Idle-client errors are emitted on the pool. Without a listener, `pg` would
  // raise an unhandled error and could terminate the process.
  nextPool.on('error', error => {
    logger.error(
      {
        event: 'database.pool_error',
        module: 'platform.db',
        error: describeDatabaseError(error),
      },
      'Unexpected PostgreSQL pool error.'
    );
  });

  pool = nextPool;
  return pool;
}

/**
 * Close the pool during graceful shutdown. Safe to call more than once.
 */
export async function closePool(): Promise<void> {
  if (pool === null) {
    return;
  }

  const currentPool = pool;
  pool = null;
  await currentPool.end();
}
