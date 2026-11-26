import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The client boundary of the notification module (D-049, ARCHITECTURE §14).
 *
 * The module index is `server-only`: it pulls in the database client. A client
 * island therefore imports a `*.shared.ts` file directly, never the barrel.
 *
 * The guard reads the source, because the property is about the *import* a
 * client island declares. A type-only import is erased at compile time, so it
 * does not break the build — it still points the island at a file it may not
 * import, and the next value import would.
 */

const ISLAND_DIRECTORY = join(process.cwd(), 'src/components/notifications');

const SHARED_FILES = [
  'src/modules/notifications/preferences.shared.ts',
  'src/modules/notifications/notification-center.shared.ts',
  'src/modules/notifications/subscriptions.shared.ts',
];

describe('the notification client islands', () => {
  it('do not import the server-only module barrel', () => {
    const offenders: string[] = [];

    for (const file of listIslandFiles()) {
      const source = readFileSync(file, 'utf8');

      if (/from\s+'@\/modules\/notifications'/.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('have the shared files they import', () => {
    for (const relativePath of SHARED_FILES) {
      expect(existsSync(join(process.cwd(), relativePath)), relativePath).toBe(true);
    }
  });

  it('keep the shared files free of the database and of the server marker', () => {
    for (const relativePath of SHARED_FILES) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

      expect(source, relativePath).not.toContain("import 'server-only'");
      expect(source, relativePath).not.toContain("@/db/");
      expect(source, relativePath).not.toContain("from 'drizzle-orm'");
    }
  });
});

function listIslandFiles(): string[] {
  if (!existsSync(ISLAND_DIRECTORY)) {
    return [];
  }

  return ['notification-preferences-form.tsx', 'notification-center-list.tsx', 'push-notification-opt-in.tsx']
    .map(name => join(ISLAND_DIRECTORY, name))
    .filter(file => existsSync(file));
}
