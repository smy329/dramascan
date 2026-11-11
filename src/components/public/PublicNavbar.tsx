'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bookmark, ChevronRight, Flame, Home, LogIn, Menu, Play, UserRound, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

type PublicNavbarProps = Readonly<{
  signedIn: boolean;
  userName?: string | null;
}>;

const PRIMARY_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/drama', label: 'Dramas' },
  { href: '/movie', label: 'Movies' },
  { href: '/categories', label: 'Categories' },
  { href: '/platforms', label: 'Platforms' },
] as const;

const SECONDARY_LINKS = [
  { href: '/trending', label: 'Trending' },
  { href: '/bookmark', label: 'Bookmark' },
] as const;

const MENU_LINKS = [
  { href: '/drama', label: 'Dramas' },
  { href: '/movie', label: 'Movies' },
  { href: '/categories', label: 'Categories' },
  { href: '/platforms', label: 'Platforms' },
  { href: '/trending', label: 'Trending' },
  { href: '/bookmark', label: 'Bookmark' },
  { href: '/help', label: 'Help' },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="DramaScan home">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_24px_-6px_var(--primary)] transition-transform group-hover:scale-105">
        <Play className="size-3.5 fill-current" aria-hidden="true" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">DramaScan</span>
    </Link>
  );
}

export function PublicNavbar({ signedIn, userName }: PublicNavbarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the menu after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes the menu and the page behind it cannot scroll while open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const accountHref = signedIn ? '/dashboard' : '/auth/signin';
  const accountLabel = signedIn ? userName?.trim() || 'Profile' : 'Sign in';
  const AccountIcon = signedIn ? UserRound : LogIn;

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6">
          <Brand />

          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {PRIMARY_LINKS.map(link => {
              const active = isActivePath(pathname, link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto hidden items-center gap-1 md:flex">
            {SECONDARY_LINKS.map(link => {
              const active = isActivePath(pathname, link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm transition-colors',
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {link.label}
                </Link>
              );
            })}

            <Link
              href={accountHref}
              className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'ml-2 gap-1.5')}
            >
              <AccountIcon className="size-3.5" aria-hidden="true" />
              {accountLabel}
            </Link>
          </div>

          <button
            type="button"
            className="ml-auto inline-flex size-10 items-center justify-center rounded-lg border border-border bg-secondary/60 text-foreground transition-colors hover:bg-secondary md:hidden"
            aria-label="Open navigation menu"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5">
          {[
            { href: '/', label: 'Home', Icon: Home },
            { href: '/trending', label: 'Trending', Icon: Flame },
            { href: '/bookmark', label: 'Bookmark', Icon: Bookmark },
            { href: accountHref, label: signedIn ? 'Profile' : 'Sign in', Icon: AccountIcon },
          ].map(({ href, label, Icon }) => {
            const active = isActivePath(pathname, href);

            return (
              <Link
                key={`${href}-${label}`}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-w-16 flex-col items-center gap-1 rounded-lg px-3 py-2 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobile slide-over menu */}
      {open && <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
          />

          <div
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 right-0 flex w-[min(20rem,85vw)] flex-col border-l border-border bg-background shadow-2xl"
          >
            <div className="flex h-16 items-center justify-between border-b border-border px-5">
              <Brand />
              <button
                type="button"
                autoFocus
                className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-secondary/60 text-foreground"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Mobile" className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
              {MENU_LINKS.map(link => {
                const active = isActivePath(pathname, link.href);

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-3 py-3 text-sm font-medium transition-colors',
                      active
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                    )}
                  >
                    {link.label}
                    <ChevronRight className="size-4 opacity-50" aria-hidden="true" />
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-border p-4">
              <Link
                href={accountHref}
                className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'w-full gap-2')}
              >
                <AccountIcon className="size-4" aria-hidden="true" />
                {signedIn ? 'Go to dashboard' : 'Sign in with Google'}
              </Link>
            </div>
          </div>
        </div>
      }
    </>
  );
}
