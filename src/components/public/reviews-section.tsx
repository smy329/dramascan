import type { JSX } from 'react';
import Link from 'next/link';

import { buildDiscoveryHref } from '@/components/public/discovery-filters';
import { ReviewForm } from '@/components/public/review-form';
import { ReviewReactionButton } from '@/components/public/review-reaction-button';
import { ReviewReportButton } from '@/components/public/review-report-button';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PublicReview, ReviewSort } from '@/modules/reviews';

/**
 * The reviews section of a details page.
 *
 * The section is a server component: it renders the reviews the reviews
 * module read, and the two interactive controls inside each card are small
 * client islands. The sort control is a set of links, so a sorted list is a
 * real URL that can be shared.
 */

/** The approved sort orders, with the labels the control shows. */
export const REVIEW_SORT_OPTIONS: ReadonlyArray<{ value: ReviewSort; label: string }> = [
  { value: 'most-enjoying', label: 'Most enjoying' },
  { value: 'newest', label: 'Newest' },
  { value: 'highest-rated', label: 'Highest rated' },
];

export type ReviewsSectionProps = Readonly<{
  /** The kind of content being reviewed. */
  type: 'drama' | 'movie';
  /** The id of the content item. */
  contentId: string;
  /** The path of the page, used to build the sort URLs. */
  basePath: string;
  /** The current query parameters. */
  params: Readonly<Record<string, string | string[] | undefined>>;
  /** The reviews to show. */
  reviews: readonly PublicReview[];
  /** How many reviews the content item has in total. */
  total: number;
  /** The current sort order. */
  sort: ReviewSort;
  /** The signed-in viewer's id, or `null` for a guest. */
  viewerId: string | null;
  /** The signed-in viewer's own review, when they have one. */
  userReview: PublicReview | null;
}>;

/** Format a timestamp as a readable date. */
function formatDate(value: Date): string {
  return value.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ReviewsSection({
  type,
  contentId,
  basePath,
  params,
  reviews,
  total,
  sort,
  viewerId,
  userReview,
}: ReviewsSectionProps): JSX.Element {
  return (
    <section aria-labelledby="reviews-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="reviews-heading" className="text-xl font-semibold text-foreground">
            Reviews
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {total === 0
              ? 'No reviews yet.'
              : `${total} review${total === 1 ? '' : 's'} from the community.`}
          </p>
        </div>

        <nav aria-label="Review sorting" className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Sort
          </span>

          <ul className="flex flex-wrap gap-2">
            {REVIEW_SORT_OPTIONS.map(option => {
              const selected = option.value === sort;

              return (
                <li key={option.value}>
                  <Link
                    href={buildDiscoveryHref(basePath, params, { reviewSort: option.value })}
                    aria-current={selected ? 'page' : undefined}
                    className={cn(
                      'inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors',
                      selected
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    )}
                  >
                    {option.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {reviews.length > 0 ? (
        <ul className="space-y-4">
          {reviews.map(review => (
            <li
              key={review.id}
              className="rounded-xl border border-border bg-card/60 p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {review.authorName}
                  </span>

                  {review.authorRating !== null ? (
                    <span className="text-xs text-muted-foreground">
                      rated {review.authorRating}/5
                    </span>
                  ) : null}
                </div>

                <time
                  dateTime={review.createdAt.toISOString()}
                  className="text-xs text-muted-foreground"
                >
                  {formatDate(review.createdAt)}
                  {review.updatedAt.getTime() > review.createdAt.getTime()
                    ? ' · edited'
                    : ''}
                </time>
              </div>

              {review.title ? (
                <h3 className="mt-3 text-base font-semibold text-foreground">{review.title}</h3>
              ) : null}

              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {review.content}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <ReviewReactionButton
                  reviewId={review.id}
                  initialCount={review.enjoyingCount}
                  initialReacted={review.reactedByViewer}
                  signedIn={viewerId !== null}
                />

                <ReviewReportButton reviewId={review.id} signedIn={viewerId !== null} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-8 text-center text-sm text-muted-foreground">
          Nobody has reviewed this title yet.
        </p>
      )}

      <div className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">
        <h3 className="text-base font-semibold text-foreground">
          {userReview ? 'Edit your review' : 'Write a review'}
        </h3>

        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          {userReview
            ? 'Your review stays at the top of your reading list; the original publication date is kept.'
            : 'Tell other viewers what you think. One review per title.'}
        </p>

        <ReviewForm
          type={type}
          contentId={contentId}
          existingReview={
            userReview ? { title: userReview.title, content: userReview.content } : null
          }
          signedIn={viewerId !== null}
        />
      </div>
    </section>
  );
}

/** The sign-in prompt shown to a guest on the reviews section. */
export function ReviewSignInPrompt(): JSX.Element {
  return (
    <Link
      href="/auth/signin"
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')}
    >
      Sign in to write a review
    </Link>
  );
}
