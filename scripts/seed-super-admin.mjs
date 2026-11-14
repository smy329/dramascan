// Provisions the single email/password Super Admin account.
//
// Usage: npm run db:seed:super-admin
//
// Reads SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD from the environment (or
// .env.local), stores only a scrypt hash in `accounts.password`, and can be
// re-run at any time to reset the password. It never prints the password or
// the hash, and every PostgreSQL error is re-thrown as a fixed message because
// raw `pg` errors embed the connection string.
//
// This is a provisioning tool, not a migration: no schema changes happen here,
// and the application never runs it at startup or build time.

import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { hashPassword } from 'better-auth/crypto';

const MIN_PASSWORD_LENGTH = 16;
const SUPER_ADMIN_SEED_LOCK_KEY = 4_627_001_034;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The application keeps local values in `.env.local`; real environment
// variables win, so CI and production can supply credentials directly.
if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

function fail(message) {
  console.error(`Super Admin seed failed: ${message}`);
  process.exit(1);
}

const rawEmail = process.env.SUPER_ADMIN_EMAIL;
const rawPassword = process.env.SUPER_ADMIN_PASSWORD;

if (!rawEmail || !rawEmail.trim()) {
  fail('SUPER_ADMIN_EMAIL is not set.');
}
const email = rawEmail.trim().toLowerCase();
if (!EMAIL_PATTERN.test(email)) {
  fail('SUPER_ADMIN_EMAIL is not a valid email address.');
}

if (!rawPassword) {
  fail('SUPER_ADMIN_PASSWORD is not set.');
}
if (rawPassword.length < MIN_PASSWORD_LENGTH) {
  fail(`SUPER_ADMIN_PASSWORD must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  fail('DATABASE_URL is not set.');
}

async function seed() {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch {
    fail('could not connect to the database.');
  }

  try {
    const passwordHash = await hashPassword(rawPassword);

    await client.query('BEGIN');
    try {
      // Serializes concurrent runs so two operators cannot race the upsert.
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [SUPER_ADMIN_SEED_LOCK_KEY]);

      const userResult = await client.query(
        `INSERT INTO users (name, email, email_verified, is_active, is_super_admin, created_at, updated_at)
         VALUES ('Super Admin', $1, true, true, true, now(), now())
         ON CONFLICT (email) DO UPDATE
           SET is_super_admin = true,
               is_active = true,
               email_verified = true,
               deleted_at = NULL,
               updated_at = now()
         RETURNING id`,
        [email]
      );

      const userId = userResult.rows[0]?.id;
      if (!userId) {
        throw new Error('user row could not be read back');
      }

      await client.query(
        `INSERT INTO accounts (account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES ($1, 'credential', $2, $3, now(), now())
         ON CONFLICT (provider_id, account_id) DO UPDATE
           SET password = excluded.password,
               updated_at = now()`,
        [userId, userId, passwordHash]
      );

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection may already be unusable; the original error matters.
      }
      throw error;
    }

    console.log(`Super Admin credential ready for ${email}.`);
  } catch (error) {
    const code = typeof error?.code === 'string' ? ` (SQLSTATE ${error.code})` : '';
    fail(`the database write was rejected${code}; no changes were committed.`);
  } finally {
    try {
      await client.end();
    } catch {
      // Closing a failed connection must not mask the real outcome.
    }
  }
}

await seed();
