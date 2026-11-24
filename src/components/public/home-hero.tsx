import type { JSX } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { normalizeSafeUrl } from '@/components/public/content-card';

/**
 * The stable homepage hero.
 *
 * The administrator picks the featured item; when the rotation is off, this
 * component shows that one item and nothing moves. The server decides which
 * item is shown and whether it is still publicly available: an unpublished or
 * trashed item never reaches this component.
 */

/** One hero item. */
export type HomeHeroItem = {
  id: string;
  type: 'drama' | 'movie';
  title: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  href: string;
  status: 'ongoing' | 'completed' | null;
};

export function HomeHero({ item }: Readonly<{ item: HomeHeroItem }>): JSX.Element {
  const banner = normalizeSafeUrl(item.banner);
  const poster = normalizeSafeUrl(item.poster);

  return (
    <section className="relative overflow-hidden border-b border-border/60">
      {banner ? (
        <img
          src={banner}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-25"
        />
      ) : null}

      <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-6 py-16 sm:py-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
            {item.type === 'movie' ? 'Featured film' : 'Featured drama'}
          </p>

          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            {item.title}
          </h1>

          {item.status ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {item.status === 'ongoing' ? 'Ongoing' : 'Completed'}
            </p>
          ) : null}

          {item.description ? (
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={item.href} className={cn(buttonVariants({ variant: 'default' }), 'gap-2')}>
              <Play className="size-4 fill-current" aria-hidden="true" />
              Details
            </Link>
          </div>
        </div>

        <div className="relative">
          {poster ? (
            <img
              src={poster}
              alt={`${item.title} poster`}
              className="mx-auto w-48 rounded-xl border border-border object-cover shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)] sm:w-64"
            />
          ) : (
            <div
              aria-hidden="true"
              className="mx-auto flex aspect-[2/3] w-48 items-center justify-center rounded-xl border border-dashed border-border bg-background/60 text-xs text-muted-foreground sm:w-64"
            >
              No artwork
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
