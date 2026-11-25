import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Integration-test configuration. These tests may use the isolated PostgreSQL
// test database configured through TEST_DATABASE_URL.
// https://vitest.dev/config/
export default defineConfig({
  test: {
    root: './',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    environment: 'node',
    globalSetup: './tests/global-setup.ts',
    // The integration tests share one PostgreSQL database, and a production
    // broadcast reaches *every* active account: publishing a drama notifies
    // every active viewer, including an account that another test file
    // created a moment earlier. Two files running at the same time therefore
    // interfere with each other, and the result depends on timing rather than
    // on the code. The files run one after another so the suite is
    // deterministic; the cost is wall-clock time, not correctness.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
