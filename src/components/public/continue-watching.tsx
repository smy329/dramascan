import type { JSX } from 'react';
import Link from 'next/link';
import { PlayCircle } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The "Continue watching" affordance on a details page.
 *
 * A Server Component: the stored position is read on the server and the card
 * is a plain link. The player decides whether to continue from that position
 * or to start over — the details page never seeks the media itself.
 */
export type ContinueWatchingProps = {
  /** The canonical href of the episode (or movie) to continue. */
  href: string;
  /** What is being continued, e.g. "Season 1 · Episode 3". */
  label: string;
  /** The stored position, in seconds. */
  positionSeconds: number;
  /** The total duration, in seconds, when it is known. */
  durationSeconds?: number;
};

/** Format a position as `h:mm:ss` or `m:ss`. */
function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const secondsWithinHour = total % 3600;
  const minutes = Math.floor(secondsWithinHour / 60);
  const remainder = secondsWithinHour % 60;

  const paddedSeconds = String(remainder).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}
export function ContinueWatching({
  href,
  label,
  positionSeconds,
  durationSeconds = 0,
}: Readonly<ContinueWatchingProps>): JSX.Element {
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ variant: 'outline', size: 'lg' }),
        'h-auto w-full flex-col items-start gap-1 px-4 py-3 text-left'
      )}
    >
      <span className="flex items-center gap-2 font-medium">
        <PlayCircle className="size-4" aria-hidden="true" />
        Continue {label}
      </span>
      <span className="text-xs font-normal text-muted-foreground">
        Resume at {formatTime(positionSeconds)}
        {durationSeconds > 0 ? ` of ${formatTime(durationSeconds)}` : ''}
      </span>
    </Link>
  );
}
