import 'server-only';

import { redirect } from 'next/navigation';

import { resolveActor } from '@/modules/authorization';
import { listPublicContentTargets, type PublicContentCard } from '@/modules/content';
import { listUserBookmarks, type UserBookmark } from '@/modules/users';

export const dynamic = 'force-dynamic';

export default async function BookmarksPage() {
  const actor = await resolveActor();

  if (actor.userId === null) {
    redirect('/auth/signin');
  }

  // The users module owns the personal list; the content module owns the
  // public availability rule. The page only composes the two answers.
  const bookmarkRows = await listUserBookmarks(actor);

  const targets = await listPublicContentTargets(
    bookmarkRows.map(bookmark => ({ type: bookmark.type, id: bookmark.contentId }))
  );

  const targetByKey = new Map(targets.map(target => [`${target.type}:${target.id}`, target]));

  const visibleBookmarks: Array<{ bookmark: UserBookmark; target: PublicContentCard }> = [];

  for (const bookmark of bookmarkRows) {
    const target = targetByKey.get(`${bookmark.type}:${bookmark.contentId}`);

    if (target) {
      visibleBookmarks.push({ bookmark, target });
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Bookmarks</h1>

          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Your personal list of bookmarked dramas and movies.
          </p>
        </header>

        {visibleBookmarks.length === 0 ? (
          <div className="empty-state text-center py-12">
            <svg
              className="w-12 h-12 mx-auto mb-4 text-gray-400 dark:text-gray-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 3 21 3 21 7" />
              <polyline points="7 22 3 22 3 17" />
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="21" y1="3" x2="21" y2="7" />
              <line x1="3" y1="22" x2="3" y2="17" />
            </svg>

            <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">
              No bookmarks yet
            </h2>

            <p className="text-gray-500 dark:text-gray-400">
              Add dramas or movies to your bookmarks to quickly access them here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleBookmarks.map(({ bookmark, target }) => (
              <a
                key={bookmark.id}
                href={target.href}
                className="group rounded-lg border overflow-hidden hover:shadow-lg transition-shadow"
              >
                {target.poster ? (
                  <img
                    src={target.poster}
                    alt={target.title}
                    loading="lazy"
                    className="w-full h-48 object-cover group-hover:opacity-90"
                  />
                ) : (
                  <div className="w-full h-48 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                    No poster
                  </div>
                )}

                <div className="p-4">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                    {target.title}
                  </h3>

                  <div className="mt-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <span>{target.type}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
