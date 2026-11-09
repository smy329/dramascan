import { describe, expect, it } from 'vitest';
import { ConfigurationError, parseServerConfig } from '@/platform/config/schema';

const DATABASE_URL = 'postgresql://dramascan_app:dummy-secret@localhost:5432/dramascan';

function parseDevelopment(overrides: Record<string, string | undefined>) {
  return parseServerConfig({ NODE_ENV: 'development', ...overrides });
}

describe('DATABASE_URL validation', () => {
  it('accepts a complete PostgreSQL connection string', () => {
    const config = parseDevelopment({ DATABASE_URL });

    expect(config.databaseUrl).toBe(DATABASE_URL);
  });

  it('rejects a non-PostgreSQL protocol without echoing credentials', () => {
    let error: unknown;

    try {
      parseDevelopment({ DATABASE_URL: 'mysql://user:dummy-secret@localhost:3306/dramascan' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).message).not.toContain('dummy-secret');
  });

  it('rejects a connection string without a hostname', () => {
    expect(() => parseDevelopment({ DATABASE_URL: 'postgresql://user:secret@/dramascan' })).toThrow(
      /DATABASE_URL/
    );
  });

  it('rejects a connection string without a database name', () => {
    expect(() =>
      parseDevelopment({ DATABASE_URL: 'postgresql://user:secret@localhost:5432/' })
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a connection string with a fragment', () => {
    expect(() => parseDevelopment({ DATABASE_URL: `${DATABASE_URL}#unexpected` })).toThrow(
      /DATABASE_URL/
    );
  });

  it('never includes the password in validation errors', () => {
    let error: unknown;

    try {
      parseDevelopment({ DATABASE_URL: 'postgresql://dramascan_app:dummy-secret@localhost:5432/' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).message).not.toContain('dummy-secret');
  });
});
