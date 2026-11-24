import { inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';

import {
  analytics_daily_aggregates,
  content_view_events,
  guest_sessions,
  playback_analytics_events,
} from '@/modules/analytics/schema';

/**
 * Shared cleanup for the analytics integration tests.
 *
 * The integration suite shares one PostgreSQL database, so every test file
 * that seeds content has to remove it again: a leftover drama would appear in
 * the public list queries and break another file's expectations.
 *
 * The cleanup is scoped by the file's own prefix. It only ever removes rows
 * this suite created, and it is safe to run before, after, and at the end of a
 * file: an interrupted run leaves nothing behind for the next one.
 */

/**
 * Remove every row the analytics suite created for one prefix.
 *
 * @param prefix the file's own prefix, for example `it-dashboard-`
 */
export async function cleanupAnalyticsFixtures(prefix: string): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${prefix}%`));

  const movieRows = await db
    .select({ id: movies.id })
    .from(movies)
    .where(like(movies.slug, `${prefix}%`));

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${prefix}%`));

  const dramaIds = dramaRows.map(row => row.id);
  const movieIds = movieRows.map(row => row.id);
  const userIds = userRows.map(row => row.id);

  if (dramaIds.length > 0) {
    await db
      .delete(playback_analytics_events)
      .where(inArray(playback_analytics_events.drama_id, dramaIds));
    await db.delete(content_view_events).where(inArray(content_view_events.content_id, dramaIds));
    await db
      .delete(analytics_daily_aggregates)
      .where(inArray(analytics_daily_aggregates.drama_id, dramaIds));
    await db.delete(episodes).where(inArray(episodes.drama_id, dramaIds));
    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  if (movieIds.length > 0) {
    await db
      .delete(playback_analytics_events)
      .where(inArray(playback_analytics_events.movie_id, movieIds));
    await db.delete(content_view_events).where(inArray(content_view_events.content_id, movieIds));
    await db
      .delete(analytics_daily_aggregates)
      .where(inArray(analytics_daily_aggregates.movie_id, movieIds));
    await db.delete(movies).where(inArray(movies.id, movieIds));
  }

  if (userIds.length > 0) {
    await db.delete(guest_sessions).where(inArray(guest_sessions.user_id, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }

  // The anonymous sessions this suite creates are named
  // `session-<prefix><uuid>`. The prefix keeps the delete scoped to this
  // file: a global delete would remove another file's session while that file
  // is still using it, and the event insert would fail on the foreign key.
  await db
    .delete(guest_sessions)
    .where(like(guest_sessions.session_id, `session-${prefix}%`));
}
