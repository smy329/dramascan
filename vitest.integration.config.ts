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
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
