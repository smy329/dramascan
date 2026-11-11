// Shared E2E database safety rules. Used by both the web-server launcher and
// the global setup so a single validation cannot be bypassed by the other.

const ALLOWED_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const MAIN_DATABASE_NAME = 'dramascan';
const TEST_SUFFIX = '_test';

export class E2EConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'E2EConfigurationError';
  }
}

/**
 * Validate and describe the dedicated E2E database.
 *
 * The E2E application must never connect to the main development database, so
 * this function only accepts PostgreSQL URLs whose database name ends in
 * `_test`, is not the main database, and (when known) differs from
 * `MAIN_DATABASE_URL`.
 *
 * @param {{ testDatabaseUrl?: string, mainDatabaseUrl?: string }} input
 * @returns {{ url: string, databaseName: string, host: string }}
 */
export function resolveTestDatabase({ testDatabaseUrl, mainDatabaseUrl }) {
  const raw = typeof testDatabaseUrl === 'string' ? testDatabaseUrl.trim() : '';

  if (raw.length === 0) {
    throw new E2EConfigurationError(
      'TEST_DATABASE_URL is required for end-to-end tests. Configure a dedicated ' +
        'PostgreSQL database whose name ends in "_test" (for example ' +
        'dramascan_test) and run the E2E suite again. The main DATABASE_URL is ' +
        'never used as a fallback.'
    );
  }

  const parsed = parsePostgresUrl(raw, 'TEST_DATABASE_URL');
  const databaseName = databaseNameFrom(parsed);

  if (databaseName.length === 0) {
    throw new E2EConfigurationError(
      'TEST_DATABASE_URL must include a database name. End-to-end tests require a ' +
        'dedicated database whose name ends in "_test".'
    );
  }

  if (databaseName === MAIN_DATABASE_NAME) {
    throw new E2EConfigurationError(
      `TEST_DATABASE_URL points at the main "${MAIN_DATABASE_NAME}" database. ` +
        'End-to-end tests never run against the main development database. Use a ' +
        'dedicated test database instead.'
    );
  }

  if (!databaseName.endsWith(TEST_SUFFIX)) {
    throw new E2EConfigurationError(
      `Refusing to use database "${databaseName}" for end-to-end tests. The database ` +
        `name must end in "${TEST_SUFFIX}" (for example dramascan_test).`
    );
  }

  if (typeof mainDatabaseUrl === 'string' && mainDatabaseUrl.trim().length > 0) {
    const mainName = databaseNameFrom(parsePostgresUrl(mainDatabaseUrl.trim(), 'DATABASE_URL'));

    if (mainName.length > 0 && mainName === databaseName) {
      throw new E2EConfigurationError(
        `TEST_DATABASE_URL and DATABASE_URL both point at "${databaseName}". ` +
          'End-to-end tests require a separate test database.'
      );
    }
  }

  return Object.freeze({
    url: raw,
    databaseName,
    host: `${parsed.hostname}:${parsed.port || '5432'}`,
  });
}

/**
 * Human-readable, credential-free description of a validated target.
 *
 * @param {{ databaseName: string, host: string }} target
 */
export function describeDatabaseTarget(target) {
  return `database "${target.databaseName}" at ${target.host}`;
}

/**
 * Derive the value the E2E application receives as TEST_DATABASE_URL.
 *
 * The application's configuration rejects a TEST_DATABASE_URL that is exactly
 * equal to DATABASE_URL, but the runtime never reads TEST_DATABASE_URL. Adding
 * a connection-name parameter keeps the same dedicated test database while
 * making the two values distinct. The main database is never referenced.
 *
 * @param {string} testDatabaseUrl
 */
export function appTestDatabaseUrl(testDatabaseUrl) {
  const parsed = new URL(testDatabaseUrl);
  parsed.searchParams.set('application_name', 'dramascan_e2e_app');
  return parsed.toString();
}

/**
 * Hide credentials before a connection string is written to logs.
 *
 * @param {string} raw
 */
export function redactConnectionString(raw) {
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return '<unparseable connection string>';
  }
}

function parsePostgresUrl(value, field) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new E2EConfigurationError(`${field} is not a valid URL.`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new E2EConfigurationError(`${field} must use the postgres or postgresql protocol.`);
  }

  if (parsed.hostname.length === 0) {
    throw new E2EConfigurationError(`${field} must include a hostname.`);
  }

  return parsed;
}

function databaseNameFrom(url) {
  try {
    return decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}
