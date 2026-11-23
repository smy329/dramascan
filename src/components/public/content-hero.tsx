import type { JSX, ReactNode } from 'react';
import { Eye, Star } from 'lucide-react';

import {
  formatRatingAverage,
  formatRatingCount,
  normalizeRating,
  type ContentRating,
} from '@/components/public/content-card';
import { normalizeSafeUrl } from '@/components/public/content-card';

/**
 * The shared details-page hero.
 *
 * A drama page and a movie page show the same information in the same place —
 * poster, banner, title, description, categories, platforms, rating, and view
 * count — so the layout lives in one component. The pages pass the data in;
 * this component never queries anything.
 *
 * A rating is shown only when real ratings exist. A view count is the number
 * the analytics module recorded: zero is a real zero, not a placeholder.
 */

export type ContentHeroTaxonomy = {
  id: string;
  name: string;
  slug: string;
};

export type ContentHeroProps = {
  /** "Drama" or "Movie" — the kind of content. */
  eyebrow: string;
  /** The title. */
  title: string;
  /** The description, when the administrator wrote one. */
  description: string | null;
  /** The poster image URL. */
  poster: string | null;
  /** The banner image URL. */
  banner: string | null;
  /** The lifecycle status of the item. */
  status?: 'ongoing' | 'completed' | null;
  /** Whether the item is published but has nothing playable yet. */
  comingSoon?: boolean;
  /** The aggregate rating, or `null` when nobody has rated the item. */
  rating?: ContentRating | null;
  /** The recorded view count. */
  viewCount: number;
  /** The categories the item belongs to. */
  categories: readonly ContentHeroTaxonomy[];
  /** The platforms the item is available on. */
  platforms: readonly ContentHeroTaxonomy[];
  /** The primary actions (play, continue, bookmark). */
  actions?: ReactNode;
  /** Anything else the page wants to show under the hero. */
  children?: ReactNode;
};

/** Format a view count the way a catalogue does. */
export function formatViewCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }

  if (count < 1_000_000) {
    return `${(Math.floor(count / 100) / 10).toFixed(1).replace(/\.0$/, '')}K`;
  }

  return `${(Math.floor(count / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`;
}

/** A small taxonomy chip. */
function TaxonomyChip({ label }: Readonly<{ label: string }>): JSX.Element {
  return (
    <span className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  );
}

export function ContentHero({
  eyebrow,
  title,
  description,
  poster,
  banner,
  status = null,
  comingSoon = false,
  rating = null,
  viewCount,
  categories,
  platforms,
  actions,
  children,
}: Readonly<ContentHeroProps>): JSX.Element {
  const safeBanner = normalizeSafeUrl(banner);
  const safePoster = normalizeSafeUrl(poster);
  const visibleRating = normalizeRating(rating);

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        {safeBanner ? (
          <img
            src={safeBanner}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-25"
          />
        ) : null}

        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:p-8">
          {safePoster ? (
            <img
              src={safePoster}
              alt={`${title} poster`}
              className="h-48 w-32 shrink-0 rounded-lg border border-border object-cover sm:h-64 sm:w-44"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-48 w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-background/60 text-xs text-muted-foreground sm:h-64 sm:w-44"
            >
              No poster
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {title}
              </h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                {status === 'ongoing' ? (
                  <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                    Ongoing
                  </span>
                ) : null}
                {status === 'completed' ? (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    Completed
                  </span>
                ) : null}
                {comingSoon ? (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    Coming soon
                  </span>
                ) : null}

                {visibleRating ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-4 fill-current text-primary" aria-hidden="true" />
                    <span>{formatRatingAverage(visibleRating.average)}</span>
                    <span className="text-xs">
                      ({formatRatingCount(visibleRating.count)}{' '}
                      {visibleRating.count === 1 ? 'rating' : 'ratings'})
                    </span>
                  </span>
                ) : (
                  <span>No ratings yet</span>
                )}

                <span className="inline-flex items-center gap-1">
                  <Eye className="size-4" aria-hidden="true" />
                  <span>
                    {formatViewCount(viewCount)} {viewCount === 1 ? 'view' : 'views'}
                  </span>
                </span>
              </div>
            </div>

            {description ? (
              <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>
            ) : null}

            {categories.length > 0 || platforms.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {categories.map(category => (
                  <TaxonomyChip key={`category-${category.id}`} label={category.name} />
                ))}
                {platforms.map(platform => (
                  <TaxonomyChip key={`platform-${platform.id}`} label={platform.name} />
                ))}
              </div>
            ) : null}

            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        </div>
      </div>

      {children}
    </section>
  );
}
