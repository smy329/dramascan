'use client';

import type { JSX } from 'react';
import { useState, useTransition } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { usePlaybackReset } from '@/components/player/playback-reset';
import { cn } from '@/lib/utils';
import { setEpisodeWatchedAction } from '@/workflows/playback/actions';

/**
 * The manual watched/unwatched control on the watch page.
 *
 * The action is a Server Action, so the viewer is resolved from the session on
 * the server. The stored progress and the watched state move together, which
 * keeps the decision consistent on every device the viewer signs in on.
 *
 * Marking the episode unwatched also tells the player to start over: the
 * server has returned the stored position to the beginning, and the browser
 * has to follow, or the next heartbeat would report the old position and
 * complete the episode again.
 */
export type WatchedToggleProps = {
  /** The episode whose state is changed. */
  episodeId: string;
  /** Whether the episode currently counts as watched. */
  initialWatched: boolean;
  /** Whether the viewer is signed in; only a signed-in viewer has a state. */
  signedIn: boolean;
};

export function WatchedToggle({
  episodeId,
  initialWatched,
  signedIn,
}: Readonly<WatchedToggleProps>): JSX.Element | null {
  const [watched, setWatched] = useState(initialWatched);
  const [isPending, startTransition] = useTransition();
  const playbackReset = usePlaybackReset();

  if (!signedIn) {
    return null;
  }

  const handleToggle = () => {
    startTransition(async () => {
      const result = await setEpisodeWatchedAction({ episodeId, watched: !watched });

      if (result.ok) {
        setWatched(result.data.watched);

        if (!result.data.watched) {
          playbackReset?.requestReset();
        }
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      aria-pressed={watched}
      className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'gap-2')}
    >
      {watched ? (
        <CheckCircle2 className="size-4" aria-hidden="true" />
      ) : (
        <Circle className="size-4" aria-hidden="true" />
      )}
      {watched ? 'Watched' : 'Mark as watched'}
    </button>
  );
}
