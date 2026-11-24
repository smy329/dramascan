import 'server-only';

import { redirect } from 'next/navigation';

import { resolveActor } from '@/modules/authorization';
import { listPublicContentTargets, listPublicEpisodeTargets } from '@/modules/content';
import { listWatchHistoryItems, type WatchHistoryItem } from '@/modules/users';

export const dynamic = 'force-dynamic';

export default async function WatchHistoryPage() {
  const actor = await resolveActor();

  if (actor.userId === null) {
    redirect('/auth/signin');
  }

  // The users module owns the viewer's own history; the content module owns the
  // public availability rule and the canonical hrefs.
  const history = await listWatchHistoryItems(actor.userId);

  const episodeIds = history
    .map(item => item.episodeId)
    .filter((episodeId): episodeId is string => episodeId !== null);

  const episodeTargets = await listPublicEpisodeTargets(episodeIds);
  const episodeById = new Map(episodeTargets.map(target => [target.episodeId, target]));

  const contentTargets = await listPublicContentTargets(
    history.map(item => ({ type: item.contentType, id: item.contentId }))
  );
  const contentByKey = new Map(
    contentTargets.map(target => [`${target.type}:${target.id}`, target])
  );

  const visibleHistory: Array<{
    item: WatchHistoryItem;
    title: string;
    poster: string | null;
    href: string;
    episodeTitle: string | null;
    type: 'drama' | 'movie';
  }> = [];

  for (const item of history) {
    const episodeTarget = item.episodeId ? episodeById.get(item.episodeId) : undefined;

    if (episodeTarget) {
      const content = contentByKey.get(`drama:${episodeTarget.dramaId}`);

      if (!content) {
        continue;
      }

      visibleHistory.push({
        item,
        title: content.title,
        poster: content.poster,
        href: episodeTarget.href,
        episodeTitle: episodeTarget.title,
        type: 'drama',
      });

      continue;
    }

    const content = contentByKey.get(`${item.contentType}:${item.contentId}`);

    if (!content) {
      continue;
    }

    visibleHistory.push({
      item,
      title: content.title,
      poster: content.poster,
      href: content.href,
      episodeTitle: null,
      type: item.contentType,
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Watch History</h1>

          <p className="text-gray-500 dark:text-gray-400 mt-1">Your recent viewing activity.</p>
        </header>

        {visibleHistory.length === 0 ? (
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
              No Watch History Yet
            </h2>

            <p className="text-gray-500 dark:text-gray-400">
              Start watching dramas or movies to build your history.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleHistory.map(({ item, title, poster, href, episodeTitle, type }) => (
              <a
                key={item.id}
                href={href}
                className="flex items-start gap-4 rounded-lg border p-4 hover:shadow-lg transition-shadow"
              >
                {poster ? (
                  <img
                    src={poster}
                    alt={title}
                    loading="lazy"
                    className="w-16 h-16 rounded shrink-0 flex-s-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 shrink-0">
                    {type.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                    {title}
                  </p>

                  {episodeTitle && (
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{episodeTitle}</p>
                  )}

                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {type} · {item.watchedAt.toLocaleDateString()}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
