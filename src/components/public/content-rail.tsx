import type { JSX } from 'react';
import Link from 'next/link';

import { ContentCard } from '@/components/public/ContentCard';
import type { ContentKind, ContentLifecycleStatus, ContentRating } from '@/components/public/content-card';

/**
 * A horizontal row of content cards.
 *
 * The homepage uses one rail per ranking or category. The rail is a server
 * component: it renders the cards it is given and never queries anything, so
 * the page decides which content is shown.
 */

/** One card in a rail. */
export type RailItem = {
  kind: ContentKind;
  title: string;
  poster?: string | null;
  href: string;
  rating?: ContentRating | null;
  status?: ContentLifecycleStatus | null;
  /** Whether the item is listed before it can be played. */
  comingSoon?: boolean;
};

export type ContentRailProps = Readonly<{
  /** The section heading. */
  title: string;
  /** The link behind "See all". */
  href?: string;
  /** The short explanation under the heading. */
  description?: string;
  /** The cards to show. */
  items: readonly RailItem[];
}>;

export function ContentRail({
  title,
  href,
  description,
  items,
}: ContentRailProps): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  const headingId = `rail-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id={headingId} className="text-xl font-semibold text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {href ? (
          <Link
            href={href}
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            See all
          </Link>
        ) : null}
      </div>

      <ul className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2">
        {items.map(item => (
          <li
            key={`${item.kind}-${item.href}`}
            className="w-36 shrink-0 snap-start sm:w-44"
          >
            <ContentCard
              kind={item.kind}
              title={item.title}
              poster={item.poster ?? null}
              rating={item.rating ?? null}
              status={item.status ?? null}
              comingSoon={item.comingSoon}
              href={item.href}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
