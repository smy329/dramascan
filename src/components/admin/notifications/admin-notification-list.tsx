'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Circle } from 'lucide-react';

import type {
  AdminNotificationPage,
  AdminNotificationView,
} from '@/modules/notifications/admin-notifications.shared';
import { setAdminNotificationReadAction } from '@/workflows/admin/admin-notifications';
import { formatCreatedAt } from '@/lib/utils';

/**
 * The administrator alert list (D-067).
 *
 * The list is what the server authorized: the page applies the audience rule,
 * and this component only renders and toggles read state. A failed toggle is
 * reported, not silently swallowed.
 */

const CATEGORY_LABELS: Record<string, string> = {
  security: 'Security',
  content: 'Content',
  system: 'System',
  maintenance: 'Maintenance',
};

function pageHref(page: number, category: string | null): string {
  const params = new URLSearchParams();

  if (category !== null) {
    params.set('category', category);
  }

  if (page > 1) {
    params.set('page', String(page));
  }

  const query = params.toString();

  return query.length > 0 ? `/admin/notifications?${query}` : '/admin/notifications';
}

export type AdminNotificationListProps = Readonly<{
  page: AdminNotificationPage;
  category: string | null;
  /** The canonical category list, passed from the server so it has one owner. */
  categories: readonly string[];
}>;

export function AdminNotificationList({
  page,
  category,
  categories,
}: Readonly<AdminNotificationListProps>) {
  const router = useRouter();
  const [items, setItems] = useState<AdminNotificationView[]>([...page.items]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggleRead = (item: AdminNotificationView) => {
    setError(null);

    startTransition(async () => {
      const result = await setAdminNotificationReadAction({
        id: item.id,
        read: item.readAt === null,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setItems(current =>
        current.map(row => {
          if (row.id !== item.id) {
            return row;
          }

          return {
            ...row,
            readAt: result.data.read ? new Date().toISOString() : null,
          };
        })
      );
      router.refresh();
    });
  };

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));

  return (
    <div className="space-y-4">
      <nav aria-label="Filter alerts by category" className="flex flex-wrap gap-2">
        <Link
          href={pageHref(1, null)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            category === null
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:bg-secondary'
          }`}
        >
          All
        </Link>

        {categories.map(value => (
          <Link
            key={value}
            href={pageHref(1, value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              category === value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-secondary'
            }`}
          >
            {CATEGORY_LABELS[value] ?? value}
          </Link>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alerts in this view.</p>
      ) : (
        <ul className="space-y-3">
          {items.map(item => {
            const unread = item.readAt === null;

            return (
              <li key={item.id}>
                <article className="rounded-lg border border-border bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {unread ? (
                          <Circle
                            className="size-2.5 fill-primary text-primary"
                            aria-label="Unread"
                          />
                        ) : null}
                        <h3 className="text-sm font-medium text-foreground">
                          <Link
                            href={`/admin/notifications/${item.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {item.title}
                          </Link>
                        </h3>
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                          {CATEGORY_LABELS[item.category] ?? item.category}
                        </span>
                        {item.priority === 'high' ? (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                            High
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                        {item.content}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatCreatedAt(item.createdAt)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleRead(item)}
                      disabled={isPending}
                      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      {unread ? 'Mark read' : 'Mark unread'}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav aria-label="Alert pages" className="flex items-center justify-between gap-3">
          {page.page > 1 ? (
            <Link
              href={pageHref(page.page - 1, category)}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}

          <span className="text-xs text-muted-foreground">
            Page {page.page} of {totalPages}
          </span>

          {page.page < totalPages ? (
            <Link
              href={pageHref(page.page + 1, category)}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
