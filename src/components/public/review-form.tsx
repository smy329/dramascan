'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { submitReviewAction } from '@/workflows/reviews/actions';

/**
 * The review form on a details page.
 *
 * A viewer has one active review per content item. The form therefore shows
 * the existing review when there is one and edits it in place; the reviews
 * module keeps the original creation time and stamps the last edit.
 *
 * The action is a Server Action, so the author is resolved from the session on
 * the server: the form cannot write a review on somebody else's behalf.
 */
export type ReviewFormProps = {
  /** The kind of content being reviewed. */
  type: 'drama' | 'movie';
  /** The id of the content item. */
  contentId: string;
  /** The viewer's existing review, or `null` when they have not written one. */
  existingReview: { title: string | null; content: string } | null;
  /** Whether the viewer is signed in. */
  signedIn: boolean;
};

export function ReviewForm({
  type,
  contentId,
  existingReview,
  signedIn,
}: Readonly<ReviewFormProps>): React.JSX.Element {
  const [title, setTitle] = useState(existingReview?.title ?? '');
  const [content, setContent] = useState(existingReview?.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Sign in to write a review of this title.
        </p>

        <Link
          href="/auth/signin"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')}
        >
          <MessageSquare className="size-4" aria-hidden="true" />
          Sign in to review
        </Link>
      </div>
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSavedMessage(null);

    // Whether the viewer already had a review is decided here, before the
    // action runs. The page is refreshed with the new review once the action
    // succeeds, so reading the prop afterwards would report an update even
    // when the reviewer had just published their first review.
    const wasAnUpdate = existingReview !== null;

    startTransition(async () => {
      const result = await submitReviewAction({
        type,
        contentId,
        title: title.trim().length > 0 ? title.trim() : null,
        content: content.trim(),
      });

      if (result.ok) {
        setSavedMessage(
          wasAnUpdate ? 'Your review was updated.' : 'Your review was published.'
        );

        return;
      }

      setError(result.error.message);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <label
          htmlFor={`review-title-${contentId}`}
          className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
        >
          Title (optional)
        </label>

        <input
          id={`review-title-${contentId}`}
          name="title"
          type="text"
          value={title}
          onChange={event => setTitle(event.target.value)}
          maxLength={200}
          disabled={isPending}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor={`review-content-${contentId}`}
          className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
        >
          Your review
        </label>

        <textarea
          id={`review-content-${contentId}`}
          name="content"
          value={content}
          onChange={event => setContent(event.target.value)}
          maxLength={5000}
          rows={5}
          required
          disabled={isPending}
          aria-describedby={`review-content-help-${contentId}`}
          className="w-full resize-y rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />

        <p id={`review-content-help-${contentId}`} className="text-xs text-muted-foreground">
          Up to 5000 characters.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {savedMessage ? (
        <p role="status" className="text-sm text-muted-foreground">
          {savedMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
      >
        {isPending
          ? 'Saving...'
          : existingReview
            ? 'Update your review'
            : 'Publish your review'}
      </button>
    </form>
  );
}
