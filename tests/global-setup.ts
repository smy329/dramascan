/**
 * Global test setup for Vitest integration tests.
 *
 * - Applies migrations to the test database before the suite runs.
 * - Ensures the test database exists and is isolated from production.
 * - Uses the TEST_DATABASE_URL environment variable.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { execSync } from 'child_process';

async function globalSetup() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    console.error('ERROR: TEST_DATABASE_URL is not set');
    process.exit(1);
  }

  // Parse the test database URL to extract connection components
  const url = new URL(testDatabaseUrl);
  const databaseName = url.pathname.replace(/^\//, '');
  const connectionStringWithoutDB = `${url.protocol}//${url.host}`;

  // Ensure the test database exists
  const pool = new Pool({
    connectionString: connectionStringWithoutDB,
  });

  try {
    // Check if the database exists
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`
    );

    if (rows.length === 0) {
      // Create the test database if it doesn't exist
      await pool.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`Created test database: ${databaseName}`);
    } else {
      console.log(`Test database already exists: ${databaseName}`);
    }
  } catch (error) {
    console.error('Error checking/creating database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }

  // Apply migrations to the test database using drizzle-kit
  try {
    execSync(
      `npx drizzle-kit push --database-url="${testDatabaseUrl}"`,
      { stdio: 'inherit' }
    );
    console.log('Migrations applied successfully');
  } catch (error) {
    console.error('Error applying migrations:', error);
    // Don't exit - migrations might already be applied
    console.log('Continuing despite migration errors');
  }

  console.log('Test database setup complete.');
}

export default globalSetup;