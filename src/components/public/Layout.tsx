/**
 * Public website layout component.
 *
 * Provides a consistent responsive structure for public-facing pages:
 * - Main navigation (collapsed mobile, expanded desktop)
 * - Content area with padding
 * - Footer with links and metadata
 * - Cinematic dark theme suitable for a drama streaming platform
 *
 * This layout is intentionally minimal and content-focused,
 * avoiding admin-dashboard aesthetics.
 */

import 'server-only';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Navigation link item.
 */
export type NavItem = {
  /** Route path (relative to root) */
  href: string;
  /** Display label */
  label: string;
  /** Whether this item has a dropdown */
  hasDropdown?: boolean;
  /** Dropdown items (if hasDropdown is true) */
  items?: NavItem[];
};

/** Default navigation items for the public website. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/drama', label: 'Dramas' },
  { href: '/movie', label: 'Movies' },
  { href: '/categories', label: 'Categories' },
  { href: '/platforms', label: 'Platforms' },
];

/**
 * Desktop navigation links.
 *
 * Renders top-level navigation links for desktop view.
 * Uses button links for simplicity without requiring Menu component.
 */
const desktopNavLinks = (
  <nav className="hidden sm:block space-x-8">
    {NAV_ITEMS.map((item) => {
      return (
        <a
          key={item.href}
          href={item.href}
          className="underline underline-offset-4 hover:text-primary dark:hover:text-primary/60"
        >
          {item.label}
        </a>
      );
    })}
  </nav>
);

/** Mobile navigation toggle button. */
const mobileNavToggle = (
  <Button
    variant="ghost"
    aria-label="Open main navigation"
    className="sm:hidden p-2"
  >
    <svg
      className="h-6 w-6 stroke-current stroke-2"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
    </svg>
  </Button>
);

/** Mobile navigation links (shown in drawer). */
const mobileNavLinks = (
  <nav className="fixed inset-0 z-50 py-8 bg-white dark:bg-gray-900 overflow-hidden">
    <ul className="flex flex-col w-full max-w-none space-y-4 px-8 pb-8">
      {NAV_ITEMS.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="block rounded-md px-2 py-2 text-lg font-medium text-gray-900 dark:text-gray-100 hover:bg-primary/5 dark:hover:bg-primary/10"
        >
          {item.label}
        </a>
      ))}
    </ul>
  </nav>
);

/** Mobile navigation drawer overlay. */
const mobileNavDrawerOverlay = (
  <div className="fixed inset-0 z-40 bg-black/50 dark:bg-black/50 opacity-0 transition-visibility duration-300 pointer-events-none" aria-hidden="true" />
);

/** Hero section for the homepage. */
export function HeroSection(): JSX.Element {
  return (
    <section className="bg-gradient-to-b from-black/90 via-black/80 to-black/70 min-h-screen relative">
      <div className="absolute inset-0"></div>

      <div className="relative max-w-7xl mx-auto px-6 py-24 sm:py-32">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-primary/60 text-sm uppercase tracking-wider mb-6">Stream Dramas & Movies</p>
            <h1 className="text-5xl sm:text-6xl font-bold text-white dark:text-gray-100 leading-none mb-6">
              Watch International Drama & Movies
            </h1>
            <p className="text-lg text-gray-400 dark:text-gray-500 mb-8">
              Discover thousands of dramas and movies from around the world. Your
              next favorite story is just a click away.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Button variant="default" className="py-3 px-6">
                Browse Dramas
              </Button>
              <Button variant="outline" className="py-3 px-6">
                Browse Movies
              </Button>
            </div>
          </div>

          {/* Illustration/visual - keep it simple and cinematic */}
          <div className="hidden sm:block">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <p className="text-muted-foreground">Featured Content</p>
            </Card>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <a
        href="#features"
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-400 dark:text-gray-500 text-sm hover:text-primary transition-colors"
      >
        Scroll down
      </a>
    </section>
  );
}

/** Feature highlights section. */
export function FeaturesSection(): JSX.Element {
  return (
    <section className="py-20 sm:py-32 bg-gray-900 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          <FeatureCard title="Cinematic Experience" description="High-quality streaming with support for multiple resolutions and aspect ratios." />
          <FeatureCard title="Extensive Library" description="Thousands of dramas and movies from around the world, regularly updated." />
          <FeatureCard title="Multiple Languages" description="Support for multiple subtitles and audio languages." />
        </div>
      </div>
    </section>
  );
}

/** Feature card component. */
type FeatureCardProps = {
  title: string;
  description: string;
};

export function FeatureCard({ title, description }: FeatureCardProps): JSX.Element {
  return (
    <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </Card>
  );
}

/** How it works section. */
export function HowItWorksSection(): JSX.Element {
  return (
    <section className="py-20 sm:py-32 bg-gray-900 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur rounded-lg">
            <div className="text-5xl font-bold text-primary">1</div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mt-3">Search</h3>
            <p className="text-muted-foreground text-sm">
              Find your favorite drama or movie by title, genre, or actor.
            </p>
          </div>

          <div className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur rounded-lg">
            <div className="text-5xl font-bold text-primary">2</div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mt-3">Watch</h3>
            <p className="text-muted-foreground text-sm">
              Stream instantly in your browser with no registration required.
            </p>
          </div>

          <div className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur rounded-lg">
            <div className="text-5xl font-bold text-primary">3</div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mt-3">Enjoy</h3>
            <p className="text-muted-foreground text-sm">
              Enjoy ad-free streaming on any device.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Public page base layout.
 *
 * Wraps page content with consistent padding and background.
 */
export function PublicPageLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <main className="min-h-screen bg-gray-900 dark:bg-gray-950">
      {/* Hero section on home page */}
      {title === 'Home' ? (
        <HeroSection />
      ) : null}

      {/* Features section */}
      <FeaturesSection />

      {/* How it works section */}
      <HowItWorksSection />

      {/* Content area */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        {children}
      </div>

      {/* Footer */}
      <PublicFooter />
    </main>
  );
}

/**
 * Public page component with shared layout.
 *
 * Usage:
 * <PublicPageLayout title="Home">
 *   <p>Welcome to DramaScan</p>
 * </PublicPageLayout>
 */
export function PublicPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <PublicPageLayout title={title} description={description}>
      {children}
    </PublicPageLayout>
  );
}

/**
 * Public website footer component.
 */
export function PublicFooter(): JSX.Element {
  return (
    <footer className="border-t border-gray-900/20 dark:border-gray-900/20 my-12">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand/links */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">DramaScan</h3>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm text-muted-foreground dark:text-muted-foreground/60">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="hover:text-primary dark:hover:text-primary/60">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Categories</h3>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm text-muted-foreground dark:text-muted-foreground/60">
              <li>
                <a href="/categories" className="hover:text-primary dark:hover:text-primary/60">
                  Drama Categories
                </a>
              </li>
              <li>
                <a href="/categories" className="hover:text-primary dark:hover:text-primary/60">
                  Movie Categories
                </a>
              </li>
              <li>
                <a href="/platforms" className="hover:text-primary dark:hover:text-primary/60">
                  Platforms
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Legal</h3>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm text-muted-foreground dark:text-muted-foreground/60">
              <li>
                <a href="/" className="hover:text-primary dark:hover:text-primary/60">
                  Home
                </a>
              </li>
              <li>
                <a href="/" className="hover:text-primary dark:hover:text-primary/60">
                  FAQ
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright */}
        <div className="border-t border-gray-900/20 dark:border-gray-900/20 pt-6 pt-12">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground/60">
            © {new Date().getFullYear()} DramaScan. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}