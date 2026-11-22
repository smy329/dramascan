import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Architectural guard for the single-connection transaction rule.
 *
 * A Drizzle transaction is bound to one PostgreSQL connection. Starting two
 * queries on that connection at the same time is deprecated by the driver
 * (`Calling client.query() when the client is already executing a query`) and
 * is removed in pg 9. The deprecation is easy to reintroduce by accident:
 * `Promise.all` over two reads inside a transaction callback reads naturally
 * and looks harmless.
 *
 * The guard therefore forbids `Promise.all` inside a `.transaction(...)`
 * callback. Queries that are genuinely independent belong on the pool, where
 * each one checks out its own connection.
 */

const PROJECT_ROOT = process.cwd();

const SOURCE_DIRECTORIES = ['src'];

const FILE_EXTENSIONS = ['.ts', '.tsx'];

type TransactionBody = {
  startLine: number;
  body: string;
};

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listFiles(path);
    }

    return FILE_EXTENSIONS.some(extension => path.endsWith(extension)) ? [path] : [];
  });
}

/**
 * Find the body of every `.transaction(...)` callback.
 *
 * The callback is the arrow function that receives the transaction handle, so
 * the body is the block that follows its `=>`.
 */
function findTransactionBodies(source: string): TransactionBody[] {
  const bodies: TransactionBody[] = [];
  const call = /\.transaction\s*\(/g;
  let match = call.exec(source);

  while (match !== null) {
    const closeParenthesis = findMatchingParenthesis(source, match.index + match[0].length - 1);

    if (closeParenthesis === -1) {
      match = call.exec(source);
      continue;
    }

    const arrow = source.lastIndexOf('=>', closeParenthesis);
    const openingBrace = arrow === -1 ? -1 : source.indexOf('{', arrow);

    if (arrow !== -1 && openingBrace !== -1 && openingBrace < closeParenthesis) {
      const closingBrace = findMatchingBrace(source, openingBrace);

      if (closingBrace !== -1) {
        bodies.push({
          startLine: source.slice(0, openingBrace).split('\n').length,
          body: source.slice(openingBrace, closingBrace + 1),
        });
      }
    }

    match = call.exec(source);
  }

  return bodies;
}

/** The index of the parenthesis that closes the one at `start`. */
function findMatchingParenthesis(source: string, start: number): number {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '(') {
      depth += 1;
    } else if (source[index] === ')') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/** The index of the brace that closes the one at `start`. */
function findMatchingBrace(source: string, start: number): number {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function readSources(): { file: string; source: string }[] {
  return SOURCE_DIRECTORIES.flatMap(directory => listFiles(join(PROJECT_ROOT, directory))).map(
    file => ({
      file: relative(PROJECT_ROOT, file).split('\\').join('/'),
      source: readFileSync(file, 'utf8'),
    })
  );
}

describe('single-connection transaction rule', () => {
  it('runs no queries concurrently inside a transaction callback', () => {
    const offenders = readSources().flatMap(({ file, source }) =>
      findTransactionBodies(source).flatMap(({ startLine, body }) =>
        body.split('\n').flatMap((line, index) => {
          if (!line.includes('Promise.all')) {
            return [];
          }

          return [`${file}:${startLine + index}`];
        })
      )
    );

    expect(offenders).toEqual([]);
  });

  it('still finds the source files it is meant to protect', () => {
    expect(readSources().length).toBeGreaterThan(0);
  });
});
