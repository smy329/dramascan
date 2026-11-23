import { useEffect, useState } from 'react';
import { db } from '@/db/client';
import { eq, and } from 'drizzle-orm';

import { playback_progress, watched_state } from '@/modules/users/schema';
import { resolveActor } from '@/modules/authorization';

type ContinueWatchingProps = {
  dramaId: string;
  dramaSlug: string;
};

export function ContinueWatching({ dramaId, dramaSlug }: ContinueWatchingProps) {
  const [progress, setProgress] = useState<
    Array<{
      episodeId: string;
      title: string;
      description: string | null;
      episodeNumber: number | null;
      positionSeconds: number;
      durationSeconds: number;
      thresholdMet: boolean;
      isWatched: boolean;
    }>
  >([]);

  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState<{ userId: string | null } | null>(null);

  useEffect(() => {
    loadProgress();
  }, [dramaId, dramaSlug]);

  async function loadProgress() {
    setLoading(true);

    try {
      const actorInfo = await resolveActor();
      setActor(actorInfo);

      if (!actorInfo || actorInfo.userId === null) {
        setLoading(false);
        return;
      }

      const userId = actorInfo.userId;

      // 1. Fetch unwatched or partially watched episodes for this drama.
      const rows = (await db
        .select({
          episodeId: playback_progress.episode_id,
          position: playback_progress.position,
          duration: playback_progress.duration,
          completed: playback_progress.completed,
        })
        .from(playback_progress)
        .where(
          and(
            eq(playback_progress.user_id, userId),
            eq(playback_progress.completed, false)
          )
        )
        .orderBy(playback_progress.episode_id)) as any[];

      // 2. For each episode, check the watched_state for threshold status.
      const thresholdChecks: boolean[] = [];
      for (const row of rows) {
        const [watched] = (await db
          .select({
            threshold_met: watched_state.threshold_met,
          })
          .from(watched_state)
          .where(
            and(
              eq(watched_state.user_id, userId),
              eq(watched_state.episode_id, row.episodeId)
            )
          )
          .limit(1)) as any;

        thresholdChecks.push(watched?.threshold_met);
      }

      const progressData = rows.map((row, idx) => {
        const thresholdMet = thresholdChecks[idx];
        return {
          episodeId: String(row.episodeId),
          title: 'Episode',
          description: null,
          episodeNumber: 0,
          positionSeconds: Number(row.position),
          durationSeconds: Number(row.duration),
          thresholdMet: thresholdMet ?? false,
          isWatched: thresholdMet === true,
        };
      });

      setProgress(progressData);
      setLoading(false);
    } catch (err) {
      setLoading(false);
      console.error('Failed to load continue watching:', err);
    }
  }

  if (loading) {
    return <div className="p-8 text-muted-foreground">Loading continue watching…</div>;
  }

  if (!actor || actor.userId === null) {
    return (
      <div className="p-8 text-muted-foreground">
        <p>Sign in to continue watching.</p>
      </div>
    );
  }

  if (progress.length === 0) {
    return (
      <div className="p-8 text-muted-foreground">
        <p>No continue watching progress.</p>
      </div>
    );
  }

  const getBorderClass = (isCurrent: boolean) =>
    `rounded-md border border-${
      isCurrent ? 'primary' : 'border-border'
    } p-4 hover:bg-muted-focus transition-colors ${
      isCurrent ? 'bg-primary/10' : ''
    }`;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-muted-foreground">
        Continue watching
        {progress.length > 1 ? `(${progress.length} episodes)` : ''}
      </p>

      {progress.map((ep) => (
        <div key={ep.episodeId} className={getBorderClass(ep.thresholdMet)}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h4 className="font-medium truncate">
                {ep.title}
              </h4>
              {ep.episodeNumber !== null && (
                <p className="text-xs text-muted-foreground">
                  Episode {ep.episodeNumber}
                </p>
              )}
              {ep.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {ep.description}
                </p>
              )}
            </div>

            <div className="w-24 flex flex-col flex-shrink-0 gap-1">
              <p className="text-xs font-medium text-muted-foreground">
                {ep.positionSeconds}s / {ep.durationSeconds}s
              </p>
              <p className="text-xs font-medium {ep.thresholdMet ? 'text-primary' : 'text-muted-foreground'}">
                {ep.thresholdMet ? 'Watched' : 'In progress'}
              </p>

              <button
                onClick={() => {
                  window.location.href = `/drama/${dramaId}/${dramaSlug}/episode/${ep.episodeId}`;
                }}
                className="mt-2 rounded-md border border-primary text-primary px-3 py-1 text-xs font-medium"
              >
                Resume
              </button>

              <button
                onClick={() => {
                  window.location.href = `/drama/${dramaId}/${dramaSlug}/episode/${ep.episodeId}`;
                }}
                className="mt-1 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium"
              >
                Restart
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
