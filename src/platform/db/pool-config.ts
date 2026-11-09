import type { PoolConfig } from 'pg';

/**
 * Conservative pool limits for the single low-RAM Next.js process.
 *
 * The pool is intentionally small: PostgreSQL connections are expensive and
 * the application is the only client. Timeouts prevent a hung database or a
 * leaked transaction from exhausting server resources.
 */
export const DATABASE_POOL_LIMITS = Object.freeze({
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  maxLifetimeSeconds: 1_800,
  maxUses: 5_000,
  statementTimeoutMillis: 15_000,
  queryTimeoutMillis: 15_000,
  idleInTransactionTimeoutMillis: 30_000,
  keepAliveInitialDelayMillis: 10_000,
});

export type DatabaseErrorDetails = Readonly<{
  name: string;
  code: string | null;
  message: string;
}>;

const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"'<>]+/gi;
const PASSWORD_PATTERN = /(password\s*[=:]\s*)[^\s&;,'"]+/gi;

/**
 * Build the runtime pool configuration from the validated connection string.
 * Credentials are passed through to `pg` only; they are never logged.
 */
export function createPoolConfig(databaseUrl: string): PoolConfig {
  return {
    connectionString: databaseUrl,
    application_name: 'dramascan',
    max: DATABASE_POOL_LIMITS.max,
    min: 0,
    idleTimeoutMillis: DATABASE_POOL_LIMITS.idleTimeoutMillis,
    connectionTimeoutMillis: DATABASE_POOL_LIMITS.connectionTimeoutMillis,
    maxLifetimeSeconds: DATABASE_POOL_LIMITS.maxLifetimeSeconds,
    maxUses: DATABASE_POOL_LIMITS.maxUses,
    allowExitOnIdle: false,
    keepAlive: true,
    keepAliveInitialDelayMillis: DATABASE_POOL_LIMITS.keepAliveInitialDelayMillis,
    statement_timeout: DATABASE_POOL_LIMITS.statementTimeoutMillis,
    query_timeout: DATABASE_POOL_LIMITS.queryTimeoutMillis,
    idle_in_transaction_session_timeout: DATABASE_POOL_LIMITS.idleInTransactionTimeoutMillis,
  };
}

/**
 * Convert an unknown error into details that are safe for structured logs.
 * Connection URLs and password-like values are removed before logging.
 */
export function describeDatabaseError(error: unknown): DatabaseErrorDetails {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      code: null,
      message: 'Non-error value received.',
    };
  }

  return {
    name: error.name,
    code: getErrorCode(error),
    message: redactDatabaseMessage(error.message),
  };
}

function getErrorCode(error: Error): string | null {
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return null;
}

function redactDatabaseMessage(message: string): string {
  return message
    .replace(DATABASE_URL_PATTERN, '[redacted-database-url]')
    .replace(PASSWORD_PATTERN, '$1[redacted]');
}
