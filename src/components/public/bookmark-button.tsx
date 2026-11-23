'use client';

import type { JSX } from 'react';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Bookmark, BookmarkCheck } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toggleBookmarkAction } from '@/workflows/library/actions';

/**
 * The bookmark control on a details page.
 *
 * The action is a Server Action, so the viewer is resolved from the session on
 * the server: the control cannot bookmark on somebody else's behalf, and the
 * content module re-checks that the item is publicly available before the row
 * is written.
 *
 * An anonymous viewer is offered a sign-in link instead of a control that
 * cannot work.
 */
export type BookmarkButtonProps = {
  /** The kind of content being bookmarked. */
  type: 'drama' | 'movie';
  /** The id of the content item. */
  id: string;
  /** Whether the item is already on the viewer's list. */
  initialBookmarked: boolean;
  /** Whether the viewer is signed in. */
  signedIn: boolean;
};

export function BookmarkButton({
  type,
  id,
  initialBookmarked,
  signedIn,
}: Readonly<BookmarkButtonProps>): JSX.Element {
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [isPending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Link
        href="/auth/signin"
        className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'gap-2')}
      >
        <Bookmark className="size-4" aria-hidden="true" />
        Sign in to bookmark
      </Link>
    );
  }

  const handleToggle = () => {
    startTransition(async () => {
      const result = await toggleBookmarkAction({ type, id });

      if (result.ok) {
        setBookmarked(result.data.bookmarked);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      aria-pressed={bookmarked}
      className={cn(
        buttonVariants({ variant: bookmarked ? 'default' : 'outline', size: 'lg' }),
        'gap-2'
      )}
    >
      {bookmarked ? (
        <BookmarkCheck className="size-4" aria-hidden="true" />
      ) : (
        <Bookmark className="size-4" aria-hidden="true" />
      )}
      {bookmarked ? 'Bookmarked' : 'Bookmark'}
    </button>
  );
}
