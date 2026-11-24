import type { JSX } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';

import { ContentPoster } from '@/components/public/ContentPoster';
import {
  CONTENT_AVAILABILITY_LABELS,
  CONTENT_KIND_LABELS,
  CONTENT_STATUS_LABELS,
  formatRatingAverage,
  formatRatingCount,
  normalizeRating,
  normalizeSafeUrl,
  type ContentAvailability,
  type ContentKind,
  type ContentLifecycleStatus,
  type ContentRating,
} from '@/components/public/content-card';
import { cn } from '@/lib/utils';

export type { ContentAvailability, ContentKind, ContentLifecycleStatus, ContentRating };

const STATUS_DOT_CLASSES: Record<ContentLifecycleStatus, string> = {
  ongoing: 'bg-primary',
  completed: 'bg-muted-foreground',
  'coming-soon': 'bg-foreground',
};

export type ContentCardProps = Readonly<{
  kind: ContentKind;
  title: string;
  poster?: string | null;
  rating?: ContentRating | null;
  status?: ContentLifecycleStatus | null;
  /**
   * Whether the item is listed before it can be played.
   *
   * The badge then reads "Coming Soon" instead of the lifecycle label, because
   * "you cannot watch this yet" is the more actionable fact. `undefined` means
   * the caller does not know, and the availability line is left out entirely.
   */
  comingSoon?: boolean;
  href?: string;
  className?: string;
}>;

function StatusBadge({
  status,
  label,
}: {
  status: ContentLifecycleStatus;
  label: string;
}): JSX.Element {
  return (
    <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/85 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur">
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', STATUS_DOT_CLASSES[status])}
      />
      {label}
    </span>
  );
}

function Rating({ rating }: { rating: ContentRating }): JSX.Element {
  return (
    <>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <Star className="size-3.5 fill-primary text-primary" aria-hidden="true" />
        <span aria-hidden="true">
          {formatRatingAverage(rating.average)} ({formatRatingCount(rating.count)})
        </span>
        <span className="sr-only">
          Rated {formatRatingAverage(rating.average)} out of 5 from {rating.count} ratings
        </span>
      </span>
    </>
  );
}

type CardBodyProps = {
  kind: ContentKind;
  title: string;
  posterUrl: string | null;
  rating: ContentRating | null;
  status: ContentLifecycleStatus | null;
  statusLabel: string | null;
  availability: ContentAvailability | null;
};

function renderCardBody({
  kind,
  title,
  posterUrl,
  rating,
  status,
  statusLabel,
  availability,
}: CardBodyProps): JSX.Element {
  return (
    <>
      <div className="relative">
        <ContentPoster src={posterUrl} />
        {statusLabel && status && <StatusBadge status={status} label={statusLabel} />}
      </div>

      <div className="min-w-0 space-y-1.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{title}</h3>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{CONTENT_KIND_LABELS[kind]}</span>
          {rating && <Rating rating={rating} />}
          {availability ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{CONTENT_AVAILABILITY_LABELS[availability]}</span>
            </>
          ) : null}
        </p>
      </div>
    </>
  );
}

/**
 * Presentational drama/movie card.
 *
 * The caller owns navigation, sizing, and any carousel/grid layout. Absent or
 * invalid ratings, statuses, posters, and hrefs render nothing rather than a
 * fabricated value.
 */
export function ContentCard({
  kind,
  title,
  poster,
  rating,
  status,
  comingSoon,
  href,
  className,
}: ContentCardProps): JSX.Element {
  const posterUrl = normalizeSafeUrl(poster);
  const hrefUrl = normalizeSafeUrl(href);
  const visibleRating = normalizeRating(rating);
  const dramaStatus = status ?? null;

  // A drama that is listed but not playable takes the badge over the lifecycle
  // label: "you cannot watch this yet" is the more actionable fact. A movie is
  // always playable, so it never carries the badge.
  let visibleStatus: ContentLifecycleStatus | null = null;

  if (kind === 'drama') {
    visibleStatus = comingSoon === true ? 'coming-soon' : dramaStatus;
  }

  const statusLabel = visibleStatus ? CONTENT_STATUS_LABELS[visibleStatus] : null;

  // The availability line states the plain fact for a drama. It is left out
  // when the caller does not know whether the item is playable yet.
  const availability: ContentAvailability | null =
    kind === 'drama' && typeof comingSoon === 'boolean'
      ? comingSoon
        ? 'coming-soon'
        : 'available'
      : null;

  const body = renderCardBody({
    kind,
    title,
    posterUrl,
    rating: visibleRating,
    status: visibleStatus,
    statusLabel,
    availability,
  });

  const baseClassName = cn('flex w-full min-w-0 flex-col gap-3', className);

  if (hrefUrl) {
    return (
      <article className="w-full min-w-0">
        <Link
          href={hrefUrl}
          className={cn(
            baseClassName,
            'group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
          )}
        >
          {body}
        </Link>
      </article>
    );
  }

  return <article className={baseClassName}>{body}</article>;
}
