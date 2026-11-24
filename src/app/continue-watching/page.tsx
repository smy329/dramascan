import 'server-only';

import { redirect } from 'next/navigation';

import { resolveActor } from '@/modules/authorization';
import { listPublicContentTargets, listPublicEpisodeTargets } from '@/modules/content';
import { listContinueWatchingItems, type ContinueWatchingItem } from '@/modules/users';

export const dynamic = 'force-dynamic';

/** Format a stored position as `m:ss`. */
function formatPosition(positionSeconds: number): string {
  const total = Math.max(0, Math.floor(positionSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default async function ContinueWatchingPage() {
  const actor = await resolveActor();

  if (actor.userId === null) {
    redirect('/auth/signin');
  }

  // The users module owns the viewer's own progress; the content module owns
  // the public availability rule and the canonical hrefs. The page composes
  // the two answers and never queries the tables itself.
  const items = await listContinueWatchingItems(actor.userId);

  const episodeIds = items
    .map(item => item.episodeId)
    .filter((episodeId): episodeId is string => episodeId !== null);

  const episodeTargets = await listPublicEpisodeTargets(episodeIds);
  const episodeById = new Map(episodeTargets.map(target => [target.episodeId, target]));

  const contentTargets = await listPublicContentTargets(
    items.map(item => ({ type: item.contentType, id: item.contentId }))
  );
  const contentByKey = new Map(
    contentTargets.map(target => [`${target.type}:${target.id}`, target])
  );

  const visibleItems: Array<{
    item: ContinueWatchingItem;
    title: string;
    poster: string | null;
    href: string;
  }> = [];

  for (const item of items) {
    const episodeTarget = item.episodeId ? episodeById.get(item.episodeId) : undefined;

    if (episodeTarget) {
      const content = contentByKey.get(`drama:${episodeTarget.dramaId}`);

      if (!content) {
        continue;
      }

      visibleItems.push({
        item,
        title: content.title,
        poster: content.poster,
        href: episodeTarget.href,
      });

      continue;
    }

    const content = contentByKey.get(`${item.contentType}:${item.contentId}`);

    if (!content) {
      continue;
    }

    visibleItems.push({
      item,
      title: content.title,
      poster: content.poster,
      href: content.href,
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Continue Watching
          </h1>

          <p className="text-gray-500 dark:text-gray-400 mt-1">Pick up where you left off.</p>
        </header>

        {visibleItems.length === 0 ? (
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
              No Continue Watching Items
            </h2>

            <p className="text-gray-500 dark:text-gray-400">
              There&apos;s nothing currently in your continue watching queue.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleItems.map(({ item, title, poster, href }) => (
              <div
                key={item.id}
                className="rounded-lg border overflow-hidden hover:shadow-lg transition-shadow"
              >
                {poster ? (
                  <img
                    src={poster}
                    alt={title}
                    loading="lazy"
                    className="w-full h-48 object-cover"
                  />
                ) : (
                  <div className="w-full h-48 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                    No poster
                  </div>
                )}

                <div className="p-4">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                    {title}
                  </h3>

                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {item.episodeId ? 'Episode in progress' : 'Movie'}
                  </p>

                  <div className="mt-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <span>Resume at {formatPosition(item.positionSeconds)}</span>
                  </div>

                  <a
                    href={href}
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
