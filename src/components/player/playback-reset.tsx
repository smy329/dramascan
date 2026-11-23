'use client';

import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * The "start over" signal between the watched toggle and the player.
 *
 * Marking an episode unwatched returns the stored position to the beginning.
 * The server does that on its own, but the browser still holds the old
 * position: the media element is at the end of the episode, and the next
 * heartbeat would report that position again and complete the episode a
 * second time. The viewer's explicit decision would be reversed within
 * seconds.
 *
 * The two halves therefore have to agree. The toggle asks for a reset through
 * this context, and the player answers by returning the media to the
 * beginning. Nothing else changes: the source, the subtitles, and the
 * automatic next-episode flow are untouched.
 *
 * The context is optional on purpose: the player is used in places without a
 * toggle (the movie watch page, for example), and it must work there too.
 */
type PlaybackResetValue = {
  /** Increases every time the viewer asks to start over. */
  resetVersion: number;
  /** Ask the player to return to the beginning. */
  requestReset: () => void;
};

const PlaybackResetContext = createContext<PlaybackResetValue | null>(null);

export type PlaybackResetProviderProps = Readonly<{
  children: ReactNode;
}>;

/** Share one reset signal between the watched toggle and the player. */
export function PlaybackResetProvider({
  children,
}: PlaybackResetProviderProps): JSX.Element {
  const [resetVersion, setResetVersion] = useState(0);

  const requestReset = useCallback(() => {
    setResetVersion(current => current + 1);
  }, []);

  const value = useMemo(
    () => ({ resetVersion, requestReset }),
    [resetVersion, requestReset]
  );

  return <PlaybackResetContext.Provider value={value}>{children}</PlaybackResetContext.Provider>;
}

/**
 * Read the reset signal.
 *
 * Returns `null` when no provider is mounted, which is the case for every
 * player that has no watched toggle next to it.
 */
export function usePlaybackReset(): PlaybackResetValue | null {
  return useContext(PlaybackResetContext);
}
