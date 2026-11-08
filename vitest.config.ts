import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// https://vitest.dev/config/
export default defineConfig({
  test: {
    // Run tests in project directory
    root: './',
    // Extend the test include patterns
    testTimeout: 30000,
    // Global setup/teardown for test database
    globalSetup: './tests/global-setup.ts',
    globalTeardown: './tests/global-teardown.ts',
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    // Include patterns
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/e2e/**/*.spec.ts',
    ],
    // Exclude patterns
    exclude: [
      'node_modules',
      '.next',
      'dist',
    ],
    // Environment configuration
    environment: 'node',
  },
  // Resolve aliases
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});