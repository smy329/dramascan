import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Migration rollback plans follow the age of the migration.
 *
 * Drizzle Kit does not generate down migrations by default. New migrations
 * state their rollback or forward-fix plan in the migration itself (CONVENTIONS
 * §10.3). Applied migrations are never edited (D-015), so the rollback plans
 * for journal indices 0 through 18 live in docs/development/DATABASE.md.
 */

const MIGRATIONS_DIRECTORY = join(process.cwd(), 'drizzle');
const DATABASE_DOCUMENT_PATH = join(process.cwd(), 'docs/development/DATABASE.md');
const JOURNAL_PATH = join(MIGRATIONS_DIRECTORY, 'meta/_journal.json');
const LAST_HISTORICAL_MIGRATION_INDEX = 18;

const REVERSIBILITY_STATEMENT = /Reversib(?:ility|le)\s*:/;
const REVERSIBILITY_STATEMENT_COUNT = /Reversib(?:ility|le)\s*:/g;

/**
 * Migration 0009 is the sole immutable exception. It already contained one
 * rollback statement before the historical migration files were frozen.
 * Removing that statement would edit an applied migration, so the guard
 * preserves exactly one grandfathered statement and rejects any additional
 * statement in every historical migration.
 */
const GRANDFATHERED_HISTORICAL_STATEMENT_INDEX = 9;

type JournalEntry = {
  idx: number;
  tag: string;
};

function readJournalEntries(): JournalEntry[] {
  const journal: unknown = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8'));

  if (
    typeof journal !== 'object' ||
    journal === null ||
    !('entries' in journal) ||
    !Array.isArray(journal.entries)
  ) {
    throw new Error('The Drizzle journal must contain an entries array.');
  }

  return journal.entries.map((entry: unknown) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('idx' in entry) ||
      !('tag' in entry) ||
      typeof entry.idx !== 'number' ||
      typeof entry.tag !== 'string'
    ) {
      throw new Error('Every Drizzle journal entry must contain an idx and tag.');
    }

    return { idx: entry.idx, tag: entry.tag };
  });
}

function migrationFileName(entry: JournalEntry): string {
  return `${entry.tag}.sql`;
}

function hasReversibilityStatement(entry: JournalEntry): boolean {
  const migration = readFileSync(join(MIGRATIONS_DIRECTORY, migrationFileName(entry)), 'utf8');
  return REVERSIBILITY_STATEMENT.test(migration);
}

function reversibilityStatementCount(entry: JournalEntry): number {
  const migration = readFileSync(join(MIGRATIONS_DIRECTORY, migrationFileName(entry)), 'utf8');
  return migration.match(REVERSIBILITY_STATEMENT_COUNT)?.length ?? 0;
}

function expectedHistoricalStatementCount(entry: JournalEntry): number {
  return entry.idx === GRANDFATHERED_HISTORICAL_STATEMENT_INDEX ? 1 : 0;
}

const journalEntries = readJournalEntries();
const historicalEntries = journalEntries
  .filter(entry => entry.idx <= LAST_HISTORICAL_MIGRATION_INDEX)
  .sort((left, right) => left.idx - right.idx);
const currentEntries = journalEntries
  .filter(entry => entry.idx > LAST_HISTORICAL_MIGRATION_INDEX)
  .sort((left, right) => left.idx - right.idx);

describe('the migrations', () => {
  it('state whether migrations added after the historical baseline are reversible or forward-fix-only', () => {
    const offenders = currentEntries
      .filter(entry => !hasReversibilityStatement(entry))
      .map(migrationFileName)
      .sort();

    expect(offenders).toEqual([]);
  });

  it('do not add rollback statements to historical migrations that have already been applied', () => {
    const offenders = historicalEntries
      .filter(entry => reversibilityStatementCount(entry) !== expectedHistoricalStatementCount(entry))
      .map(migrationFileName)
      .sort();

    expect(offenders).toEqual([]);
  });

  it('document the rollback plan of every historical migration in DATABASE.md', () => {
    const databaseDocument = readFileSync(DATABASE_DOCUMENT_PATH, 'utf8');
    const missing = historicalEntries
      .map(migrationFileName)
      .filter(fileName => !databaseDocument.includes(fileName))
      .sort();

    expect(missing).toEqual([]);
  });
});
