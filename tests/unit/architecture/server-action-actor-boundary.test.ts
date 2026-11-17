import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Architectural guard for the Server Action boundary.
 *
 * A module marked with the `'use server'` directive registers every export as a
 * public RPC endpoint. Its arguments arrive from the request body, so a
 * workflow that accepts a caller-supplied actor would let the caller assert any
 * identity it likes — including `isSuperAdmin: true`.
 *
 * D-031 and `docs/architecture/SECURITY.md` require the actor to be resolved
 * server-side and never accepted as an argument. Workflows in `src/workflows`
 * are ordinary server modules called by pages and route handlers; only the
 * action modules that resolve their own identity may declare the directive.
 */

const WORKFLOWS_ROOT = join(process.cwd(), 'src', 'workflows');

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path);
    }

    return path.endsWith('.ts') ? [path] : [];
  });
}

function readWorkflowSources(): { file: string; source: string }[] {
  return listTypeScriptFiles(WORKFLOWS_ROOT).map(file => ({
    file: relative(process.cwd(), file).split('\\').join('/'),
    source: readFileSync(file, 'utf8'),
  }));
}

function isServerActionModule(source: string): boolean {
  return /^\s*['"]use server['"];/.test(source);
}

describe('Server Action boundary in src/workflows', () => {
  it('never declares a Server Action module that accepts a caller-supplied actor', () => {
    const offenders = readWorkflowSources()
      .filter(({ source }) => isServerActionModule(source))
      .filter(({ source }) => /\bActorContext\b/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('still finds the action modules it is meant to protect', () => {
    const actionModules = readWorkflowSources().filter(({ source }) =>
      isServerActionModule(source)
    );

    expect(actionModules.length).toBeGreaterThan(0);
  });
});
