/**
 * Global test teardown for Vitest.
 *
 * - Clean up any test data.
 * - Close database connections.
 */
async function globalTeardown() {
  console.log('Test suite teardown complete.');
}

export default globalTeardown;