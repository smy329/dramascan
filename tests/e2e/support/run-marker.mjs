// Marker file shared by the E2E launcher and global setup.
//
// The marker lives in the OS temporary directory (never in test-results, which
// Playwright deletes at the start of a run) and its name contains a per-run
// random token. A marker left behind by an earlier run can therefore never be
// mistaken for proof that the current run started the server.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * @param {string} token
 */
export function runMarkerPath(token) {
  return path.join(tmpdir(), `dramascan-e2e-${token}.json`);
}

/**
 * @param {string} token
 * @param {{ databaseName: string, baseUrl: string, pid: number, startedAt: string }} payload
 */
export function writeRunMarker(token, payload) {
  writeFileSync(runMarkerPath(token), JSON.stringify(payload), { mode: 0o600 });
}

/**
 * @param {string} token
 * @returns {{ databaseName: string, baseUrl: string, pid: number, startedAt: string } | null}
 */
export function readRunMarker(token) {
  try {
    const contents = readFileSync(runMarkerPath(token), 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(contents);

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {string} token
 */
export function removeRunMarker(token) {
  rmSync(runMarkerPath(token), { force: true });
}
