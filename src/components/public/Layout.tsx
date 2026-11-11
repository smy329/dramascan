/**
 * Public website layout.
 *
 * The public site is a dark, cinematic surface: a sticky header, a compact
 * mobile bottom bar, a slide-over menu for secondary destinations, and a
 * content column that stays readable at every breakpoint.
 *
 * `PublicPageLayout` resolves the signed-in state on the server. If the auth
 * subsystem is unavailable (for example, a local environment without the
 * required configuration), the public site still renders as a guest instead
 * of failing the whole page.
 */

import type { JSX, ReactNode } from 'react';
import Link from 'next/link';

import { Clapperboard, Film, Play, Tv } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { PublicNavbar } from '@/components/public/PublicNavbar';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Primary public destinations. */
export type NavItem = {
  href: string;
  label: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/drama', label: 'Dramas' },
  { href: '/movie', label: 'Movies' },
  { href: '/categories', label: 'Categories' },
  { href: '/platforms', label: 'Platforms' },
  { href: '/trending', label: 'Trending' },
  { href: '/bookmark', label: 'Bookmark' },
];

type PublicPageLayoutProps = Readonly<{
  title: string;
  children?: ReactNode;
}>;

/** Best-effort session lookup for the public header. */
async function resolveNavUser(): Promise<{ signedIn: boolean; userName?: string | null }> {
  try {
    // Dynamic import keeps a missing configuration from breaking public pages.
    const { getActiveSession } = await import('@/platform/auth/session');
    const session = await getActiveSession();

    return session
      ? { signedIn: true, userName: session.userName }
      : { signedIn: false, userName: null };
  } catch {
    return { signedIn: false, userName: null };
  }
}

/** Home hero. */
export function HeroSection(): JSX.Element {
  return (
    <section className="hero-texture relative overflow-hidden border-b border-border/60">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 sm:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-32">
        <div>
          <p className="mb-5 text-sm text-muted-foreground">
            International drama and film, curated in one place.
          </p>

          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            International drama and movies, in one place.
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Stream standout series and films from Korea, Japan, China, Thailand, and beyond —
            without the clutter.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/drama"
              className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'gap-2')}
            >
              <Play className="size-4 fill-current" aria-hidden="true" />
              Browse dramas
            </Link>
            <Link
              href="/movie"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'gap-2')}
            >
              Browse movies
            </Link>
          </div>
        </div>

        <div className="relative">
          <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Now building</span>
              <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                Preview
              </span>
            </div>

            <div className="mt-8 flex aspect-[4/3] items-center justify-center rounded-lg border border-border bg-[radial-gradient(circle_at_30%_20%,rgba(226,61,92,0.22),transparent_55%),radial-gradient(circle_at_75%_80%,rgba(226,61,92,0.12),transparent_60%)]">
              <span className="flex size-16 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                <Play className="size-6 fill-current" aria-hidden="true" />
              </span>
            </div>

            <p className="mt-6 text-sm font-medium text-foreground">
              The catalogue is being prepared.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              New series and films will appear here first.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const BROWSE_LINKS = [
  {
    href: '/drama',
    label: 'Dramas',
    description: 'Series from Korea, Japan, China, Thailand, and beyond.',
    Icon: Clapperboard,
  },
  {
    href: '/movie',
    label: 'Movies',
    description: 'Feature films, from festival favourites to crowd-pleasers.',
    Icon: Film,
  },
  {
    href: '/platforms',
    label: 'Platforms',
    description: 'Where the stories you want are available to stream.',
    Icon: Tv,
  },
] as const;

/** Browse tiles shown on the home page. */
export function BrowseSection(): JSX.Element {
  return (
    <section aria-labelledby="browse-heading" className="mx-auto w-full max-w-6xl px-6 py-14">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 id="browse-heading" className="text-2xl font-semibold text-foreground">
            Find your next story
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Start with a format, then narrow it down.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {BROWSE_LINKS.map(({ href, label, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-secondary/40"
          >
            <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-secondary text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="mt-5 text-base font-medium text-foreground">{label}</span>
            <span className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {description}
            </span>
            <span className="mt-5 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Browse {label.toLowerCase()}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * The three-step explanation shown once, on the home page.
 */
export function HowItWorksSection(): JSX.Element {
  const steps = [
    {
      title: 'Find something',
      description:
        'Browse by format, genre, or platform. Search by title when you already know what you want.',
    },
    {
      title: 'Press play',
      description:
        'Stream in your browser. No plugins, no downloads, no account required to watch.',
    },
    {
      title: 'Pick it back up',
      description:
        'Your place in an episode is remembered, so you can return to the exact scene you left.',
    },
  ];

  return (
    <section aria-labelledby="how-it-works-heading" className="border-t border-border/60">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <h2 id="how-it-works-heading" className="text-2xl font-semibold text-foreground">
          How it works
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Three things, in this order. That is the whole product.
        </p>

        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-border bg-card p-6">
              <span className="text-xs font-medium tabular-nums text-primary">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-3 text-base font-medium text-foreground">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Page heading used by every public page except the home page. */
export function PageHeader({
  eyebrow,
  title,
  description,
}: Readonly<{ eyebrow: string; title: string; description: string }>): JSX.Element {
  return (
    <header className="max-w-2xl">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">{description}</p>
    </header>
  );
}

/** Consistent "nothing to show" block for catalogue pages. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: Readonly<{
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}>): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-base font-medium text-foreground">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

/** Footer column. */
function FooterColumn({
  heading,
  links,
}: Readonly<{ heading: string; links: ReadonlyArray<{ href: string; label: string }> }>) {
  return (
    <div>
      <h2 className="text-sm font-medium text-foreground">{heading}</h2>
      <ul className="mt-4 space-y-3 text-sm">
        {links.map(link => (
          <li key={`${heading}-${link.href}-${link.label}`}>
            <Link
              href={link.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Public website footer. */
export function PublicFooter(): JSX.Element {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2.5" aria-label="DramaScan home">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Play className="size-3.5 fill-current" aria-hidden="true" />
              </span>
              <span className="text-[15px] font-semibold text-foreground">DramaScan</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              A focused home for international drama and film.
            </p>
          </div>

          <FooterColumn
            heading="Browse"
            links={[
              { href: '/drama', label: 'Dramas' },
              { href: '/movie', label: 'Movies' },
              { href: '/categories', label: 'Categories' },
            ]}
          />

          <FooterColumn
            heading="Discover"
            links={[
              { href: '/platforms', label: 'Platforms' },
              { href: '/trending', label: 'Trending' },
              { href: '/bookmark', label: 'Bookmarks' },
            ]}
          />

          <FooterColumn
            heading="Support"
            links={[
              { href: '/help', label: 'Help' },
              { href: '/auth/signin', label: 'Sign in' },
            ]}
          />
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border/60 pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} DramaScan. All rights reserved.</p>
          <p>Made for people who stay for the last episode.</p>
        </div>
      </div>
    </footer>
  );
}

/** Public page base layout. */
export async function PublicPageLayout({
  title,
  children,
}: PublicPageLayoutProps): Promise<JSX.Element> {
  const { signedIn, userName } = await resolveNavUser();
  const isHome = title === 'Home';

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicNavbar signedIn={signedIn} userName={userName} />

      <main id="main-content" className="flex-1 pb-24 md:pb-0">
        {isHome ? (
          <>
            <HeroSection />
            <BrowseSection />
            <HowItWorksSection />
          </>
        ) : null}

        {children ? (
          <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">{children}</div>
        ) : null}
      </main>

      <PublicFooter />
    </div>
  );
}

/** Public page component with shared layout. */
export async function PublicPage({ title, children }: PublicPageLayoutProps): Promise<JSX.Element> {
  return <PublicPageLayout title={title}>{children}</PublicPageLayout>;
}
