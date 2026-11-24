'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Bookmark, Mail, Phone, X } from 'lucide-react';

import { copyTextToClipboard } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * The share controls on a details page.
 *
 * The canonical path is passed in by the server page, so a film never shares
 * a drama address and the shared link carries the slug the public route needs.
 *
 * The absolute origin is only known in the browser. It is read *after* the
 * first render — never during it — because a client component is also
 * rendered on the server, where `window` does not exist. Reading it during
 * the render crashed the whole details page with "window is not defined".
 */
export type ShareButtonProps = {
  /** The canonical public path of the item, for example `/drama/<id>/<slug>`. */
  href: string;
  /** The title of the item. */
  title: string;
};

export function ShareButton({ href, title }: Readonly<ShareButtonProps>): JSX.Element {
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Before the browser has told us the origin the relative path is used, so
  // the server-rendered markup stays identical to the first client render.
  const shareUrl = origin.length > 0 ? `${origin}${href}` : href;
  const shareText = `Check out: ${title} - ${shareUrl}`;

  const handleCopy = async () => {
    // The address bar already holds the canonical URL of the page the viewer
    // is on, including the slug.
    await copyTextToClipboard(window.location.href);
  };

  const iconClass = cn(
    'inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground',
    'transition-colors hover:bg-secondary hover:text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
  );

  return (
    <div className="flex gap-2">
      <button type="button" onClick={handleCopy} aria-label="Copy URL" className={iconClass}>
        <Bookmark className="size-4" aria-hidden="true" />
      </button>

      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
        aria-label="Share on Facebook"
        target="_blank"
        rel="noopener noreferrer"
        className={iconClass}
      >
        <Mail className="size-4" aria-hidden="true" />
      </a>

      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        aria-label="Share on WhatsApp"
        target="_blank"
        rel="noopener noreferrer"
        className={iconClass}
      >
        <Phone className="size-4" aria-hidden="true" />
      </a>

      <a
        href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(
          title
        )}`}
        aria-label="Share on Telegram"
        target="_blank"
        rel="noopener noreferrer"
        className={iconClass}
      >
        <X className="size-4" aria-hidden="true" />
      </a>

      <a
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
          title
        )}&url=${encodeURIComponent(shareUrl)}`}
        aria-label="Share on X"
        target="_blank"
        rel="noopener noreferrer"
        className={iconClass}
      >
        <X className="size-4" aria-hidden="true" />
      </a>
    </div>
  );
}
