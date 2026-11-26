import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A catalogue has one owner.
 *
 * Two copies of the same list drift: the player starts reporting an event the
 * server does not know, or the server stores an event the player never sends.
 * The same is true of a date formatter: two copies format the same instant
 * differently, and the viewer sees two different timestamps for one row.
 *
 * The guard reads the source, because the property is about where the list is
 * *defined*.
 */

const SOURCE_ROOT = join(process.cwd(), 'src');

const SHARED_CATALOGUE = join(SOURCE_ROOT, 'modules/analytics/playback-events.shared.ts');
const SERVER_WORKFLOW = join(SOURCE_ROOT, 'modules/analytics/playback-analytics-workflow.ts');
const CLIENT_REPORTER = join(SOURCE_ROOT, 'components/player/playback-analytics.ts');

const UTILS_FILE = join(SOURCE_ROOT, 'lib/utils.ts');

describe('the playback event catalogue', () => {
  it('is defined once, in a client-safe shared file', () => {
    expect(existsSync(SHARED_CATALOGUE)).toBe(true);

    const shared = readFileSync(SHARED_CATALOGUE, 'utf8');

    expect(shared).not.toContain("import 'server-only'");
    expect(shared).not.toContain('@/db/');
    expect(shared).toContain('PLAYBACK_EVENT_TYPES');
  });

  it('is the catalogue the server workflow uses', () => {
    const workflow = readFileSync(SERVER_WORKFLOW, 'utf8');

    // The module imports its own files relatively; the path may also be the
    // absolute alias. Either way it must be the shared catalogue.
    expect(workflow).toMatch(/from\s+'\.?\/playback-events\.shared'/);
    expect(workflow).not.toMatch(/export const PLAYBACK_EVENT_TYPES\s*=/);
  });

  it('is the catalogue the client reporter uses', () => {
    const reporter = readFileSync(CLIENT_REPORTER, 'utf8');

    expect(reporter).toContain('@/modules/analytics/playback-events.shared');
    expect(reporter).not.toMatch(/export const PLAYBACK_ANALYTICS_EVENT_TYPES\s*=/);
  });
});

describe('the notification timestamp formatter', () => {
  it('is defined once, in the shared utils', () => {
    expect(existsSync(UTILS_FILE)).toBe(true);

    const utils = readFileSync(UTILS_FILE, 'utf8');

    expect(utils).toContain('export function formatCreatedAt');
  });

  it('is not redefined in a component', () => {
    const offenders = listTypeScriptFiles(join(SOURCE_ROOT, 'components'))
      .filter(file => /function\s+formatCreatedAt\s*\(/.test(readFileSync(file, 'utf8')))
      .map(file => relative(process.cwd(), file).split('\\').join('/'))
      .sort();

    expect(offenders).toEqual([]);
  });
});

function listTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry: string) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path);
    }

    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}
