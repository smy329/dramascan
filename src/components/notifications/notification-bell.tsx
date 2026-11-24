'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The notification bell (Prompt 149).
 *
 * The bell shows the viewer's own unread count. The count is resolved on the
 * server, so it is never a number the browser invented.
 *
 * The bell is a link rather than a button: the notification centre is a real
 * page, so it can be opened in a new tab, bookmarked, and shared.
 */

export type NotificationBellProps = Readonly<{
  /** How many notifications the viewer has not read. */
  unreadCount: number;
  /** Whether the viewer is signed in. */
  signedIn: boolean;
}>;

export function NotificationBell({
  unreadCount,
  signedIn,
}: Readonly<NotificationBellProps>) {
  if (!signedIn) {
    return null;
  }

  const count = Math.max(0, unreadCount);
  const label = count === 1 ? '1 unread notification' : `${count} unread notifications`;

  return (
    <Link
      href="/notifications"
      className="relative inline-flex size-10 items-center justify-center rounded-lg border border-border bg-secondary/60 text-foreground transition-colors hover:bg-secondary"
      aria-label={count > 0 ? `Notifications, ${label}` : 'Notifications'}
    >
      <Bell className="size-4" aria-hidden="true" />

      {count > 0 ? (
        <span
          className={cn(
            'absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-5 text-primary-foreground'
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
