import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

const ISLAND_DIRECTORIES = [
  join(process.cwd(), 'src/components/notifications'),
  join(process.cwd(), 'src/components/admin/notifications'),
];

const SHARED_FILES = [
  'src/modules/notifications/preferences.shared.ts',
  'src/modules/notifications/notification-center.shared.ts',
  'src/modules/notifications/subscriptions.shared.ts',
  'src/modules/notifications/admin-notifications.shared.ts',
  'src/modules/notifications/announcements.shared.ts',
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
      expect(source, relativePath).not.toContain('@/db/');
      expect(source, relativePath).not.toContain("from 'drizzle-orm'");
    }
  });

  it('read the administrator DTOs from the shared files', () => {
    // The administrator islands render server-built rows. The shape of a row
    // lives in a shared file, so the server and the browser cannot drift.
    const expectations: ReadonlyArray<readonly [string, string]> = [
      [
        'src/components/admin/notifications/admin-notification-list.tsx',
        '@/modules/notifications/admin-notifications.shared',
      ],
      [
        'src/components/admin/notifications/admin-notification-detail.tsx',
        '@/modules/notifications/admin-notifications.shared',
      ],
      [
        'src/components/admin/notifications/announcement-admin.tsx',
        '@/modules/notifications/announcements.shared',
      ],
    ];

    for (const [relativePath, sharedImport] of expectations) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

      expect(source, relativePath).toContain(sharedImport);
    }
  });
});

function listIslandFiles(): string[] {
  const files: string[] = [];

  for (const directory of ISLAND_DIRECTORIES) {
    if (!existsSync(directory)) {
      continue;
    }

    for (const entry of readdirSync(directory)) {
      if (entry.endsWith('.tsx')) {
        files.push(join(directory, entry));
      }
    }
  }

  return files;
}
