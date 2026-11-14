/// <reference types="drizzle-orm" />
import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

// drizzle-kit loads `.env`, but this project keeps local values in `.env.local`.
// Without this, `db:migrate` sees an empty DATABASE_URL and migrations are
// silently skipped. Real environment variables take precedence over the file,
// so CI and production are unaffected.
if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
