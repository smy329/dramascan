'use client';

import { ArrowUpRight, ChevronDown, LogOut, UserRound } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { googleSignOut } from '@/workflows/auth/google-oauth';
import type { AdminShellUser } from './admin-shell';

type AdminAccountMenuProps = Readonly<{ user: AdminShellUser }>;

/**
 * Derive up to two initials from the display name. Falls back to the email's
 * first letter, then to `?`, so the avatar is never empty.
 */
export function getInitials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const firstWord = words[0];

  if (firstWord !== undefined) {
    const lastWord = words.length > 1 ? words.at(-1) : undefined;
    const initials =
      lastWord === undefined
        ? firstWord.charAt(0)
        : `${firstWord.charAt(0)}${lastWord.charAt(0)}`;
    return initials.toUpperCase();
  }

  const emailInitial = email.trim().charAt(0);
  return emailInitial === '' ? '?' : emailInitial.toUpperCase();
}

/**
 * Header account menu. Sign out reuses the existing Google sign-out server
 * action instead of introducing a second implementation.
 */
export function AdminAccountMenu({ user }: AdminAccountMenuProps) {
  const initials = getInitials(user.name, user.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Open account menu"
            className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            >
              {initials}
            </span>
            <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
            <ChevronDown
              aria-hidden="true"
              className="hidden size-4 text-muted-foreground sm:block"
            />
          </button>
        }
      />

      <DropdownMenuContent align="end" sideOffset={6}>
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem href="/dashboard" closeOnClick>
          <UserRound aria-hidden="true" />
          Your account
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem href="/" closeOnClick>
          <ArrowUpRight aria-hidden="true" />
          View site
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <form action={googleSignOut}>
          <DropdownMenuItem render={<button type="submit" />}>
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
