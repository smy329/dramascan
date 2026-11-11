import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Unit-test configuration. Unit tests must not touch the network or a database.
// Integration tests use vitest.integration.config.ts, which adds database setup.
// https://vitest.dev/config/
export default defineConfig({
  test: {
    root: './',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
