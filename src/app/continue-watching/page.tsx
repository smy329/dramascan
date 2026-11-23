import { redirect } from 'next/navigation';
import { getActiveSession } from '@/platform/auth/session';
import 'server-only';

import { db } from '@/db/client';
import { playback_progress } from '@/modules/users/schema';
import { eq, sql, desc, inArray } from 'drizzle-orm';
import { dramas } from '@/modules/content/schema';
import { movies } from '@/modules/content/schema';

export const dynamic = 'force-dynamic';

export default async function ContinueWatchingPage() {
  const session = await getActiveSession();

  if (!session) {
    redirect('/auth/signin');
  }

  // Fetch playback progress for the authenticated user
  // Only include items that are not yet completed
  const progress = await db
    .select({
      id: playback_progress.id,
      content_type: playback_progress.content_type,
      content_id: playback_progress.content_id,
      drama_id: playback_progress.drama_id,
      movie_id: playback_progress.movie_id,
      episode_id: playback_progress.episode_id,
      position: playback_progress.position,
      duration: playback_progress.duration,
      completed: playback_progress.completed,
      lastWatchedAt: playback_progress.last_watched_at,
    })
    .from(playback_progress)
    .where(
      sql`${playback_progress.user_id} = ${session.userId} AND ${playback_progress.completed} = false`
    )
    .orderBy(desc(playback_progress.last_watched_at));

  // Fetch drama IDs and titles for display
  const dramaIds = [...new Set(
    progress.map((p) => p.drama_id).filter((id): id is string => id !== null)
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
    progress.map((p) => p.movie_id).filter((id): id is string => id !== null)
  )];

  const movieTitles = await db
    .select({ id: movies.id, title: movies.title, poster: movies.poster })
    .from(movies)
    .where(inArray(movies.id, movieIds as string[]));

  const movieTitleMap = new Map(
    movieTitles.map((m) => [m.id, { title: m.title, poster: m.poster }])
  );

  // enrich progress with titles
  const enrichedProgress = progress.map((p) => ({
    ...p,
    title: p.content_type === 'drama'
      ? dramaTitleMap.get(p.drama_id?.toString())?.title || 'Drama'
      : movieTitleMap.get(p.movie_id?.toString())?.title || 'Movie',
    poster: p.content_type === 'drama'
      ? dramaTitleMap.get(p.drama_id?.toString())?.poster
      : movieTitleMap.get(p.movie_id?.toString())?.poster,
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Continue Watching
          </h1>

          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Pick up where you left off.
          </p>
        </header>

        {enrichedProgress.length === 0 ? (
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
              No Continue Watching Items
            </h2>

            <p className="text-gray-500 dark:text-gray-400">
              There's nothing currently in your continue watching queue.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {enrichedProgress.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border overflow-hidden hover:shadow-lg transition-shadow"
              >
                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-48 object-cover"
                  />
                ) : (
                  <div
                    className="w-full h-48 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400"
                  >
                    No poster
                  </div>
                )}

                <div className="p-4">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                    {item.title}
                  </h3>

                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {item.content_type === 'drama'
                      ? `Episode in progress`
                      : `Movie`}
                  </p>

                  <div className="mt-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <span>
                      Resume at{
                        item.position !== null
                          ? ` ${item.position}s`
                          : ' starting over'
                      }
                    </span>
                  </div>

                  <a
                    href={`/drama/${item.content_id}`}
                    className="mt-2 inline-block rounded-md border border-green-600 bg-green-100 px-4 py-2 text-sm font-medium text-green-600 hover:bg-green-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
                  >
                    Resume Playback
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}