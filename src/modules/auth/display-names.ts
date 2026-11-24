import 'server-only';

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';

import { users } from './schema';

/**
 * Public display names for a set of users.
 *
 * Reviews and comments are authored by users, and a public page has to show
 * *somebody* as the author. The `users` table belongs to this module, so the
 * lookup lives here and other modules ask for it through the module's public
 * API instead of joining the identity table themselves.
 *
 * The map never contains an email address: only the display name is public,
 * and a user id that no longer resolves is simply absent from the map.
 */
export async function getUserDisplayNames(
  userIds: readonly string[]
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(userIds.filter(id => id.length > 0)));

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, uniqueIds));

  return new Map(rows.map(row => [row.id, row.name]));
}

/** The display name of one user, or `null` when the user does not exist. */
export async function getUserDisplayName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.name ?? null;
}
