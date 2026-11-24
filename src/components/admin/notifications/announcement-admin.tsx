'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, Send } from 'lucide-react';

import type { AnnouncementView } from '@/modules/notifications';
import {
  createAnnouncementAction,
  publishAnnouncementAction,
} from '@/workflows/admin/announcements';

/**
 * The announcement administration (Prompt 153).
 *
 * An administrator writes an announcement and publishes it by hand. There is
 * no scheduled publication and no recurring announcement: the announcement is
 * delivered when the administrator publishes it, and never again.
 *
 * The form creates a draft. A draft notifies nobody — publishing is a separate,
 * explicit act, so an announcement can never go out by accident.
 */

export type AnnouncementAdminProps = Readonly<{
  /** The announcements that already exist, newest first. */
  announcements: readonly AnnouncementView[];
}>;

export function AnnouncementAdmin({ announcements: initialAnnouncements }: Readonly<AnnouncementAdminProps>) {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<AnnouncementView[]>([
    ...initialAnnouncements,
  ]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const create = () => {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const result = await createAnnouncementAction({ title, content });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setAnnouncements(current => [result.data, ...current]);
      setTitle('');
      setContent('');
      setMessage('The announcement was created as a draft.');
      router.refresh();
    });
  };

  const publish = (announcement: AnnouncementView) => {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const result = await publishAnnouncementAction(announcement.id);

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setAnnouncements(current =>
        current.map(row =>
          (row.id === announcement.id
            ? { ...row, status: result.data.announcementId === row.id ? 'published' : row.status }
            : row)
        )
      );
      setMessage('The announcement was published.');
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="announcement-form-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="announcement-form-heading" className="text-base font-medium text-foreground">
          New announcement
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The announcement is created as a draft. It notifies nobody until you publish it.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="announcement-title" className="text-sm font-medium text-foreground">
              Title
            </label>
            <input
              id="announcement-title"
              name="title"
              type="text"
              maxLength={200}
              value={title}
              onChange={event => setTitle(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div>
            <label htmlFor="announcement-content" className="text-sm font-medium text-foreground">
              Message
            </label>
            <textarea
              id="announcement-content"
              name="content"
              rows={5}
              maxLength={5000}
              value={content}
              onChange={event => setContent(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={create}
              disabled={isPending || title.trim().length === 0 || content.trim().length === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
            >
              <Megaphone className="size-4" aria-hidden="true" />
              {isPending ? 'Working…' : 'Create draft'}
            </button>

            {message ? (
              <p role="status" className="text-sm text-muted-foreground">
                {message}
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="announcement-list-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="announcement-list-heading" className="text-base font-medium text-foreground">
          Announcements
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The most recent announcements, newest first.
        </p>

        {announcements.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No announcements yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {announcements.map(announcement => {
              const published = announcement.status === 'published';

              return (
                <li key={announcement.id}>
                  <article
                    aria-label={announcement.title}
                    className="rounded-lg border border-border bg-background p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium text-foreground">{announcement.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {announcement.content}
                        </p>
                      </div>

                      <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {published ? 'Published' : 'Draft'}
                      </span>
                    </div>

                    {!published ? (
                      <button
                        type="button"
                        onClick={() => publish(announcement)}
                        disabled={isPending}
                        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
                      >
                        <Send className="size-3.5" aria-hidden="true" />
                        Publish {announcement.title}
                      </button>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
