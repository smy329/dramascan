import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/platform/config', () => ({
  ConfigurationError: class ConfigurationError extends Error {
    readonly issues: readonly string[];

    constructor(issues: readonly string[]) {
      super(
        ['Invalid environment configuration:', ...issues.map(issue => `- ${issue}`)].join('\n')
      );
      this.name = 'ConfigurationError';
      this.issues = issues;
    }
  },
  serverConfig: Object.freeze({ databaseUrl: null }),
}));

import { getPool } from '@/platform/db/pool';

describe('getPool', () => {
  it('fails with a safe configuration error when DATABASE_URL is missing', () => {
    expect(() => getPool()).toThrowError(/DATABASE_URL is required/);
  });
});
