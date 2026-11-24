'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { normalizeSafeUrl } from '@/components/public/content-card';

/**
 * The rotating homepage hero.
 *
 * The rotation is a small client island: the server decides which items are
 * eligible and hands them over, and the client only moves between them. No
 * scheduling engine and no background work — a timer in the browser.
 *
 * When the administrator disabled the rotation the server renders the
 * `HomeHero` component instead, and this component is never mounted.
 */

/** One eligible hero item. */
export type HeroSlide = {
  id: string;
  type: 'drama' | 'movie';
  title: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  href: string;
  status: 'ongoing' | 'completed' | null;
};

/** How long one slide stays on screen. */
const ROTATION_INTERVAL_MS = 8000;

export function HomeHeroRotator({
  slides,
}: Readonly<{ slides: readonly HeroSlide[] }>): React.JSX.Element {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length < 2) {
      return undefined;
    }

    const timer = setInterval(() => {
      setIndex(current => (current + 1) % slides.length);
    }, ROTATION_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [slides.length]);

  if (slides.length === 0) {
    return <></>;
  }

  const active = slides[index] ?? slides[0]!;
  const banner = normalizeSafeUrl(active.banner);
  const poster = normalizeSafeUrl(active.poster);

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
            {active.type === 'movie' ? 'Featured film' : 'Featured drama'}
          </p>

          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            {active.title}
          </h1>

          {active.status ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {active.status === 'ongoing' ? 'Ongoing' : 'Completed'}
            </p>
          ) : null}

          {active.description ? (
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
              {active.description}
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={active.href} className={cn(buttonVariants({ variant: 'default' }), 'gap-2')}>
              <Play className="size-4 fill-current" aria-hidden="true" />
              Details
            </Link>
          </div>

          {slides.length > 1 ? (
            <div className="mt-10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIndex(current => (current - 1 + slides.length) % slides.length)}
                className="flex size-9 items-center justify-center rounded-full border border-border bg-background/70 text-foreground transition-colors hover:border-primary/50"
                aria-label="Previous featured title"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => setIndex(current => (current + 1) % slides.length)}
                className="flex size-9 items-center justify-center rounded-full border border-border bg-background/70 text-foreground transition-colors hover:border-primary/50"
                aria-label="Next featured title"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>

              <ul className="ml-2 flex items-center gap-2">
                {slides.map((slide, slideIndex) => (
                  <li key={slide.id}>
                    <button
                      type="button"
                      onClick={() => setIndex(slideIndex)}
                      aria-label={`Show ${slide.title}`}
                      aria-current={slideIndex === index}
                      className={cn(
                        'h-1.5 rounded-full transition-all',
                        slideIndex === index ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/50'
                      )}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="relative">
          {poster ? (
            <img
              src={poster}
              alt={`${active.title} poster`}
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
