import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Architectural guard for the playback workflow boundaries.
 *
 * Two rules are easy to break by accident and hard to notice afterwards:
 *
 *  1. **The playback heartbeat is a REST beacon.** The browser reports the
 *     viewer's position while the page may be closing, so the report travels
 *     over `POST /api/playback/progress` with a keepalive `fetch`
 *     (`ARCHITECTURE.md` §9.2). A Server Action cannot promise that the
 *     request survives the page being closed, so the heartbeat must not creep
 *     back into one.
 *
 *  2. **The workflow owns the transaction.** Demoting the previous default
 *     subtitle track and writing the new one is one unit of work: an episode
 *     must never end up with two default tracks, or with none. The workflow
 *     therefore opens the transaction and passes the handle to the module
 *     services. The Server Action next to it is an adapter: it resolves the
 *     actor, and it reads no table and writes no SQL. The playback workflow
 *     also never reaches into the content module's tables — the episode
 *     hierarchy belongs to the content module, which exposes it through its
 *     public API.
 */

const PROJECT_ROOT = process.cwd();

const PLAYBACK_ACTIONS = join(PROJECT_ROOT, 'src', 'workflows', 'playback', 'actions.ts');
const PLAYBACK_WORKFLOW = join(PROJECT_ROOT, 'src', 'workflows', 'admin', 'playback.ts');
const ADMIN_PLAYBACK_ACTIONS = join(PROJECT_ROOT, 'src', 'workflows', 'admin', 'playback-actions.ts');
const PLAYBACK_ROUTE = join(PROJECT_ROOT, 'src', 'app', 'api', 'playback', 'progress', 'route.ts');
const PLAYER = join(PROJECT_ROOT, 'src', 'components', 'player', 'vidstack-player.tsx');

function read(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`The file this guard protects is missing: ${relative(PROJECT_ROOT, file)}`);
  }

  return readFileSync(file, 'utf8');
}

describe('playback workflow boundaries', () => {
  it('sends the playback heartbeat over REST, not through a Server Action', () => {
    const actions = read(PLAYBACK_ACTIONS);

    // No Server Action may save a playback position.
    expect(actions).not.toMatch(/export\s+async\s+function\s+savePlaybackProgress/i);
    expect(actions).not.toMatch(/savePlaybackProgressAction/);

    // The beacon endpoint exists and the player uses it.
    expect(read(PLAYBACK_ROUTE)).toMatch(/export\s+async\s+function\s+POST/);
    expect(read(PLAYER)).toMatch(/['"]\/api\/playback\/progress['"]/);
    expect(read(PLAYER)).toMatch(/keepalive:\s*true/);
  });

  it('keeps the heartbeat workflow behind the REST route', () => {
    const route = read(PLAYBACK_ROUTE);

    expect(route).toMatch(/savePlaybackProgressWorkflow/);
    expect(route).not.toMatch(/savePlaybackProgressAction/);
  });

  it('opens the transaction in the playback workflow, not in its Server Action', () => {
    expect(read(PLAYBACK_WORKFLOW)).toMatch(/db\.transaction\(/);

    const actions = read(ADMIN_PLAYBACK_ACTIONS);

    expect(actions).not.toMatch(/from\s+['"]@\/db\/client['"]/);
    expect(actions).not.toMatch(/\bdb\.transaction\(/);
  });

  it('keeps the playback workflow free of module internals and raw SQL', () => {
    const workflow = read(PLAYBACK_WORKFLOW);

    // The episode hierarchy belongs to the content module: the playback
    // workflow asks for it through the module's public API.
    expect(workflow).not.toMatch(/@\/modules\/content\/schema/);
    expect(workflow).not.toMatch(/@\/modules\/content\/validation/);

    // The module owns its tables; the workflow writes no SQL.
    expect(workflow).not.toMatch(/from\s+['"]drizzle-orm['"]/);
    expect(workflow).not.toMatch(/\.(select|insert|update|delete)\(/);
  });

  it('keeps the playback Server Action free of module internals and raw SQL', () => {
    const actions = read(ADMIN_PLAYBACK_ACTIONS);

    expect(actions).not.toMatch(/@\/modules\/content\/schema/);
    expect(actions).not.toMatch(/from\s+['"]drizzle-orm['"]/);
    expect(actions).not.toMatch(/\.(select|insert|update|delete)\(/);
  });
});
