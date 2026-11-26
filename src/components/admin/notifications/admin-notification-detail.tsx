'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';

import type { AdminNotificationView } from '@/modules/notifications/admin-notifications.shared';
import { setAdminNotificationReadAction } from '@/workflows/admin/admin-notifications';
import { formatCreatedAt } from '@/lib/utils';

/**
 * One administrator alert (D-067).
 *
 * The alert was authorized on the server before this component rendered. The
 * only write here is the reader's own read state.
 */

function audienceLabel(notification: AdminNotificationView): string {
  if (notification.audience === 'super_admin') {
    return 'Super Admin';
  }

  if (notification.audience === 'roles') {
    return notification.audienceRoles.length > 0
      ? `Roles: ${notification.audienceRoles.join(', ')}`
      : 'Specific roles';
  }

  return 'All administrators';
}

export type AdminNotificationDetailProps = Readonly<{
  notification: AdminNotificationView;
}>;

export function AdminNotificationDetail({
  notification,
}: Readonly<AdminNotificationDetailProps>) {
  const router = useRouter();
  const [readAt, setReadAt] = useState<string | null>(notification.readAt);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggleRead = () => {
    setError(null);

    startTransition(async () => {
      const nextRead = readAt === null;
      const result = await setAdminNotificationReadAction({
        id: notification.id,
        read: nextRead,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setReadAt(nextRead ? new Date().toISOString() : null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Link
        href="/admin/notifications"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All alerts
      </Link>

      <article className="rounded-xl border border-border bg-card p-5">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {notification.title}
            </h1>
            {notification.priority === 'high' ? (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                High priority
              </span>
            ) : null}
            {readAt === null ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                Unread
              </span>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            {formatCreatedAt(notification.createdAt)} · {audienceLabel(notification)} ·{' '}
            {notification.category}
          </p>
        </header>

        <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-foreground">
          {notification.content}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleRead}
            disabled={isPending}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
          >
            <Check className="size-3.5" aria-hidden="true" />
            {readAt === null ? 'Mark read' : 'Mark unread'}
          </button>

          {notification.link !== null ? (
            <Link
              href={notification.link}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              Open the related page
            </Link>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </article>
    </div>
  );
}
