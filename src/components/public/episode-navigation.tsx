'use client';

import type { JSX, KeyboardEvent } from 'react';
import { useId, useRef, useState } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * The public episode navigation.
 *
 * A season-based drama gets a season selector and one episode list per
 * season; a flat drama gets the episode list directly, without season
 * controls. That is the difference the two structures make, and the component
 * makes it for both.
 *
 * The component is a client island because the selector is an interaction: the
 * viewer chooses a season, the episode list follows. It receives plain data —
 * the episode title, its number, its season, and the canonical href the
 * content module computed — and knows nothing about the domain modules.
 *
 * Only publicly playable episodes are ever passed in. That is the whole
 * "distinguish available, unpublished, and unavailable content" rule for the
 * public: an episode that is not published, whose season is not published, or
 * that is in the Trash is not rendered at all, so there is nothing to reveal
 * and no way to reach it through this navigation.
 */

/** One episode in the navigation. */
export type EpisodeNavigationItem = {
  id: string;
  title: string;
  /** The canonical watch route of the episode. */
  href: string;
  episodeNumber: number | null;
  position: number | null;
  seasonId: string | null;
  seasonTitle: string | null;
};

export type EpisodeNavigationProps = {
  /** The publicly playable episodes, in content order. */
  episodes: readonly EpisodeNavigationItem[];
  /** The episode the viewer is currently watching, if any. */
  currentEpisodeId: string | null;
  /** The drama's structure: season-based or flat. */
  structureType: 'flat' | 'season_based';
};

type EpisodeGroup = {
  id: string;
  label: string;
  episodes: EpisodeNavigationItem[];
};

/** The id of the group that holds the episodes without a season. */
const UNASSIGNED_GROUP_ID = 'unassigned';

/**
 * The label of one season group.
 *
 * The season title is what the administrator named the season, so it is the
 * label the viewer sees. The stored position is an ordering key, not a
 * display number, and is never shown as one. A season without a title is
 * numbered by its place in the drama instead.
 */
function seasonGroupLabel(episode: EpisodeNavigationItem, index: number): string {
  if (episode.seasonId === null) {
    return 'Other episodes';
  }

  if (episode.seasonTitle !== null && episode.seasonTitle.trim().length > 0) {
    return episode.seasonTitle;
  }

  return `Season ${index + 1}`;
}

/**
 * Group the episodes by season, keeping the content order inside a season.
 *
 * An episode of a season-based drama that has no season is not dropped: it
 * would be a playable episode the viewer could not reach. It gets its own
 * group instead.
 */
function groupEpisodes(
  episodes: readonly EpisodeNavigationItem[],
  structureType: 'flat' | 'season_based'
): EpisodeGroup[] {
  if (structureType === 'flat') {
    return episodes.length === 0
      ? []
      : [{ id: 'episodes', label: 'Episodes', episodes: [...episodes] }];
  }

  const groups: EpisodeGroup[] = [];
  const bySeason = new Map<string, EpisodeGroup>();

  for (const episode of episodes) {
    const groupId = episode.seasonId ?? UNASSIGNED_GROUP_ID;

    const existing = bySeason.get(groupId);

    if (existing) {
      existing.episodes.push(episode);
      continue;
    }

    const group: EpisodeGroup = {
      id: groupId,
      label: seasonGroupLabel(episode, groups.length),
      episodes: [episode],
    };

    bySeason.set(groupId, group);
    groups.push(group);
  }

  return groups;
}

/** The label a viewer sees for one episode. */
function episodeLabel(episode: EpisodeNavigationItem, index: number): string {
  if (episode.episodeNumber !== null) {
    return `Episode ${episode.episodeNumber}`;
  }

  if (episode.position !== null) {
    return `Episode ${episode.position}`;
  }

  return `Episode ${index + 1}`;
}

export function EpisodeNavigation({
  episodes,
  currentEpisodeId,
  structureType,
}: Readonly<EpisodeNavigationProps>): JSX.Element | null {
  const baseId = useId();
  const groups = groupEpisodes(episodes, structureType);

  // The season that holds the current episode is the one the viewer is
  // looking at; without a current episode the first season is opened.
  const defaultGroupId = (() => {
    const current = groups.find(group =>
      group.episodes.some(episode => episode.id === currentEpisodeId)
    );

    return current?.id ?? groups[0]?.id ?? null;
  })();

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(defaultGroupId);
  const [lastCurrentEpisodeId, setLastCurrentEpisodeId] = useState(currentEpisodeId);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  // Moving to another episode re-opens the season that holds it.
  if (currentEpisodeId !== lastCurrentEpisodeId) {
    setLastCurrentEpisodeId(currentEpisodeId);
    setSelectedGroupId(defaultGroupId);
  }

  if (groups.length === 0) {
    return null;
  }

  const activeGroupId = selectedGroupId ?? defaultGroupId ?? groups[0]?.id ?? null;

  /** Move the focus to another season, as the tab pattern expects. */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, groupId: string) => {
    const index = groups.findIndex(group => group.id === groupId);

    if (index < 0) {
      return;
    }

    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % groups.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + groups.length) % groups.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = groups.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();

    const nextGroup = groups[nextIndex];

    if (!nextGroup) {
      return;
    }

    setSelectedGroupId(nextGroup.id);
    tabRefs.current.get(nextGroup.id)?.focus();
  };

  return (
    <nav aria-label="Episodes" className="space-y-6">
      {structureType === 'season_based' ? (
        <div
          role="tablist"
          aria-label="Seasons"
          className="flex flex-wrap gap-2"
        >
          {groups.map(group => {
            const isSelected = group.id === activeGroupId;

            return (
              <button
                key={group.id}
                ref={element => {
                  if (element) {
                    tabRefs.current.set(group.id, element);
                  } else {
                    tabRefs.current.delete(group.id);
                  }
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${group.id}`}
                aria-selected={isSelected}
                aria-controls={`${baseId}-panel-${group.id}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSelectedGroupId(group.id)}
                onKeyDown={event => handleKeyDown(event, group.id)}
                className={cn(
                  'min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors',
                  'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  isSelected
                    ? 'border-primary bg-primary/10 font-medium text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
                )}
              >
                {group.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {groups.map(group => {
        const isSelected = group.id === activeGroupId;

        return (
          <section
            key={group.id}
            id={`${baseId}-panel-${group.id}`}
            role={structureType === 'season_based' ? 'tabpanel' : undefined}
            aria-labelledby={
              structureType === 'season_based' ? `${baseId}-tab-${group.id}` : undefined
            }
            hidden={structureType === 'season_based' && !isSelected}
          >
            {structureType === 'flat' ? (
              <h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label}
              </h3>
            ) : null}

            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.episodes.map((episode, index) => {
                const isCurrent = episode.id === currentEpisodeId;

                return (
                  <li key={episode.id}>
                    <Link
                      href={episode.href}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={cn(
                        'flex h-full flex-col gap-1 rounded-lg border px-3 py-2 text-sm transition-colors',
                        'hover:border-primary/60 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                        isCurrent
                          ? 'border-primary bg-primary/10 font-medium'
                          : 'border-border bg-background'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span>{episodeLabel(episode, index)}</span>
                        {isCurrent ? (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[0.7rem] font-medium text-primary-foreground">
                            Now playing
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{episode.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
