/**
 * Trash expiry cleanup command.
 *
 * Removes content from Trash that has exceeded the default 30-day retention period.
 * This is a short-lived command (runs once and exits), not a persistent worker.
 *
 * Protection rules:
 *   - Content that was recently restored (deleted_at set to null) is protected.
 *   - Content currently in Trash (deleted_at IS NOT NULL) older than 30 days is
 *     permanently deleted.
 *   - Active content (deleted_at IS NULL) is never affected.
 *
 * Logs outcomes and failures to stdout.
 *
 * Usage:  DATABASE_URL=postgresql://... node scripts/trash-cleanup.mjs
 *         or:  npm run db:trash:cleanup
 */

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { Client } from 'pg';

/** Default retention period in days. */
const DEFAULT_RETENTION_DAYS = 30;

/** Tables that support Trash (have deleted_at column). */
const TRASH_TABLES = [
  'dramas',
  'seasons',
  'episodes',
  'movies',
];

/** Logging helper. */
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

/** Load .env.local tolerating the encoding it is stored in. */
function loadLocalEnv() {
  if (!existsSync('.env.local')) {
    return;
  }

  const contents = readFileSync('.env.local');
  let text;

  if (contents.length >= 2 && contents[0] === 0xff && contents[1] === 0xfe) {
    text = contents.subarray(2).toString('utf16le');
  } else if (contents.length >= 2 && contents[0] === 0xfe && contents[1] === 0xff) {
    const body = Buffer.from(contents.subarray(2));
    if (body.length % 2 === 0) {
      body.swap16();
    }
    text = body.toString('utf16le');
  } else {
    text = contents.toString('utf8').replace(/^\uFEFF/, '');
  }

  for (const [key, value] of Object.entries(parse(text))) {
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

/** Run the trash expiry cleanup. */
async function runCleanup() {
  loadLocalEnv();

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    log('DATABASE_URL is not set. Set it in .env.local or the environment.', 'ERROR');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const retentionInterval = `interval '${DEFAULT_RETENTION_DAYS} days'`;

    log(`Starting Trash expiry cleanup (retention: ${DEFAULT_RETENTION_DAYS} days)`);
    log(`Current time: ${new Date().toISOString()}`);

    let totalPermanentlyDeleted = 0;
    let totalErrors = 0;
    const perTableResults = {};

    for (const table of TRASH_TABLES) {
      try {
        // Find rows in Trash older than the retention period
        const countResult = await client.query(
          `SELECT count(*)::bigint AS count FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - ${retentionInterval}`
        );
        const rowsToDelete = parseInt(countResult.rows[0].count, 10);

        if (rowsToDelete === 0) {
          log(`[${table}] No expired Trash records found.`);
          perTableResults[table] = { deleted: 0, message: 'No expired records' };
          continue;
        }

        log(`[${table}] Found ${rowsToDelete} expired Trash record(s) to permanently delete.`);

        // Permanently delete the expired Trash records
        const deleteResult = await client.query(
          `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - ${retentionInterval} RETURNING id`
        );

        const deletedCount = deleteResult.rowCount ?? 0;
        totalPermanentlyDeleted += deletedCount;

        perTableResults[table] = {
          deleted: deletedCount,
          message: deletedCount > 0 ? `${deletedCount} record(s) permanently deleted` : 'No records deleted',
        };

        log(
          `[${table}] Permanently deleted ${deletedCount} expired Trash record(s).`,
          'DEBUG'
        );
      } catch (error) {
        totalErrors++;
        log(`[${table}] Error during cleanup: ${error.message}`, 'ERROR');
        perTableResults[table] = { deleted: 0, message: `Error: ${error.message}` };
      }
    }

    // Summary
    log('---');
    log(`Trash expiry cleanup complete.`);
    log(`Total permanently deleted: ${totalPermanentlyDeleted}`);
    log(`Tables with errors: ${totalErrors}`);

    for (const [table, result] of Object.entries(perTableResults)) {
      log(`  [${table}] ${result.message}`);
    }

    if (totalErrors > 0) {
      log(`Some tables had errors. Review the output above.`, 'WARN');
      process.exitCode = 1;
    } else {
      log('No errors encountered.');
      process.exitCode = 0;
    }
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'ERROR');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// Invoke the cleanup
runCleanup().catch(error => {
  log(`Unhandled error: ${error.message}`, 'ERROR');
  process.exitCode = 1;
});