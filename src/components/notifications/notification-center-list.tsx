'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellOff, CheckCheck, ExternalLink } from 'lucide-react';

import type { NotificationView } from '@/modules/notifications/notification-center.shared';
import {
  dismissNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/workflows/notifications/center';
import { cn } from '@/lib/utils';

/**
 * The notification centre (Prompt 149).
 *
 * The list shows the viewer's own notifications and nothing else. Marking a
 * notification as read and dismissing it both go through Server Actions that
 * are scoped to the signed-in viewer, so a guessed id cannot reach somebody
 * else's notification.
 */

export type NotificationCenterListProps = Readonly<{
  notifications: readonly NotificationView[];
  unreadCount: number;
  totalCount: number;
}>;

/** The label of an event type, shown on the notification row. */
const EVENT_LABELS: Record<string, string> = {
  new_episode: 'New episode',
  new_drama: 'New drama',
  new_drama_season: 'New season',
  website_announcement: 'Announcement',
  account_security: 'Account & security',
  review_report_resolved: 'Report resolved',
  content_report_resolved: 'Report resolved',
};

function formatCreatedAt(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(value));
}

export function NotificationCenterList({
  notifications: initialNotifications,
  unreadCount: initialUnreadCount,
  totalCount: initialTotalCount,
}: Readonly<NotificationCenterListProps>) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationView[]>([
    ...initialNotifications,
  ]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [isPending, startTransition] = useTransition();

  const markRead = (notification: NotificationView) => {
    if (notification.isRead) {
      return;
    }

    setNotifications(current =>
      current.map(row =>
        (row.id === notification.id ? { ...row, isRead: true, readAt: new Date() } : row)
      )
    );
    setUnreadCount(current => Math.max(0, current - 1));

    startTransition(async () => {
      const result = await markNotificationReadAction(notification.id);

      if (!result.ok) {
        router.refresh();
      }
    });
  };

  const markAllRead = () => {
    setNotifications(current =>
      current.map(row => (row.isRead ? row : { ...row, isRead: true, readAt: new Date() }))
    );
    setUnreadCount(0);

    startTransition(async () => {
      const result = await markAllNotificationsReadAction();

      if (!result.ok) {
        router.refresh();
      }
    });
  };

  const dismiss = (notification: NotificationView) => {
    setNotifications(current => current.filter(row => row.id !== notification.id));

    startTransition(async () => {
      const result = await dismissNotificationAction(notification.id);

      if (!result.ok) {
        router.refresh();
      }
    });
  };

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
        <span className="flex size-12 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
          <BellOff className="size-5" aria-hidden="true" />
        </span>
        <h2 className="mt-5 text-base font-medium text-foreground">No notifications yet</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          New episodes from the dramas you bookmark, newly published titles, and website
          announcements appear here.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Notification history" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {unreadCount > 0
            ? `${unreadCount} unread of ${initialTotalCount} notifications`
            : `${initialTotalCount} notifications`}
        </p>

        <button
          type="button"
          onClick={markAllRead}
          disabled={isPending || unreadCount === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
        >
          <CheckCheck className="size-4" aria-hidden="true" />
          Mark all as read
        </button>
      </div>

      <ul className="space-y-2">
        {notifications.map(notification => (
          <li key={notification.id}>
            <article
              className={cn(
                'rounded-xl border bg-card p-4 transition-colors',
                notification.isRead ? 'border-border' : 'border-primary/40 bg-primary/5'
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {EVENT_LABELS[notification.eventType] ?? notification.eventType}
                  </p>
                  <h3 className="text-sm font-medium text-foreground">{notification.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {notification.content}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCreatedAt(notification.createdAt)}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {notification.link ? (
                    <Link
                      href={notification.link}
                      onClick={() => markRead(notification)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                    >
                      Open
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </Link>
                  ) : null}

                  {!notification.isRead ? (
                    <button
                      type="button"
                      onClick={() => markRead(notification)}
                      className="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                    >
                      Mark as read
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => dismiss(notification)}
                    className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
