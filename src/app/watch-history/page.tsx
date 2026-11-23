import { redirect } from 'next/navigation';
import { getActiveSession } from '@/platform/auth/session';
import 'server-only';

import { db } from '@/db/client';
import { watch_history } from '@/modules/users/schema';
import { eq, sql, desc, inArray } from 'drizzle-orm';
import { dramas } from '@/modules/content/schema';
import { movies } from '@/modules/content/schema';

export const dynamic = 'force-dynamic';

export default async function WatchHistoryPage() {
  const session = await getActiveSession();

  if (!session) {
    redirect('/auth/signin');
  }

  // Fetch the user's watch history, ordered by most recent first
  const history = await db
    .select({
      id: watch_history.id,
      content_type: watch_history.content_type,
      content_id: watch_history.content_id,
      drama_id: watch_history.drama_id,
      movie_id: watch_history.movie_id,
      episode_id: watch_history.episode_id,
      watched_at: watch_history.watched_at,
      watch_duration: watch_history.watch_duration,
    })
    .from(watch_history)
    .where(eq(watch_history.user_id, session.userId))
    .orderBy(desc(watch_history.watched_at));

  // Fetch drama IDs and titles for display
  const dramaIds = [...new Set(
    history.map((h) => h.drama_id).filter((id): id is string => id !== null)
  )];

  const dramaTitles = await db
    .select({ id: dramas.id, title: dramas.title, poster: dramas.poster })
    .from(dramas)
    .where(inArray(dramas.id, dramaIds as string[]));

  const dramaTitleMap = new Map(
    dramaTitles.map((d) => [d.id, { title: d.title, poster: d.poster }])
  );

  // Fetch movie IDs and titles for display
  const movieIds = [...new Set(
    history.map((h) => h.movie_id).filter((id): id is string => id !== null)
  )];

  const movieTitles = await db
    .select({ id: movies.id, title: movies.title, poster: movies.poster })
    .from(movies)
    .where(inArray(movies.id, movieIds as string[]));

  const movieTitleMap = new Map(
    movieTitles.map((m) => [m.id, { title: m.title, poster: m.poster }])
  );

  // enrich history with titles
  const enrichedHistory = history.map((h) => ({
    ...h,
    title: h.content_type === 'drama'
      ? dramaTitleMap.get(h.drama_id!.toString())?.title || 'Drama'
      : movieTitleMap.get(h.movie_id!.toString())?.title || 'Movie',
    poster: h.content_type === 'drama'
      ? dramaTitleMap.get(h.drama_id!.toString())?.poster
      : movieTitleMap.get(h.movie_id!.toString())?.poster,
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Watch History
          </h1>

          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Your recent viewing activity.
          </p>
        </header>

        {enrichedHistory.length === 0 ? (
          <div className="empty-state text-center py-12">
            <svg
              className="w-12 h-12 mx-auto mb-4 text-gray-400 dark:text-gray-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 3 21 3 21 7" />
              <polyline points>7 22 3 22 3 17</polyline>
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="21" y1="3" x2="21" y2="7" />
              <line x1="3" y1="22" x2="3" y2="17" />
            </svg>

            <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">
              No Watch History Yet
            </h2>

            <p className="text-gray-500 dark:text-gray-400">
              Start watching dramas or movies to build your history.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {enrichedHistory.slice(0, 20).map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-4 rounded-lg border p-4 hover:shadow-lg transition-shadow"
              >
                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={item.title}
                    loading="lazy"
                    className="w-16 h-16 rounded shrink-0 flex-s-0"
                  />
                ) : (
                  <div
                    className="w-16 h-16 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 shrink-0"
                  >
                    {item.type.charAt(0)}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                    {item.title}
                  </p>

                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {item.type} · {new Date(item.watched_at as string).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}