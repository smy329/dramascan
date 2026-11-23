'use client';

import { copyTextToClipboard } from '@/lib/utils';
import { Bookmark, Mail, Phone, X } from 'lucide-react';

/** Share a drama or movie details URL through various channels. */
export function ShareButton({
  type, // 'drama' or 'movie'
  id, // content ID
  title,
}: {
  type: 'drama' | 'movie';
  id: string;
  title: string;
}) {
  const handleCopy = async () => {
    let url: string;
    if (type === 'drama') {
      url = `/drama/${id}`;
    } else {
      url = `/movie/${id}`;
    }
    await copyTextToClipboard(url);
  };

  return (
    <div className="flex gap-2">
      {/* Copy URL button */}
      <button
        onClick={handleCopy}
        aria-label="Copy URL"
        className="rounded-md border p-2 hover:bg-gray-100 dark:hover:bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 transition-colors"
      >
        <Bookmark className="size-4" aria-hidden="true" />
      </button>

      {/* Facebook share */}
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
          `/drama/${id}`
        )}`}
        aria-label="Share on Facebook"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border p-2 hover:bg-blue-100 dark:hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 transition-colors"
      >
        <Mail className="size-4" />
      </a>

      {/* WhatsApp share */}
      <a
        href={`https://wa.me/?text=${encodeURIComponent(
          `Check out: ${title} - ${window.location.origin}/drama/${id}`
        )}`}
        aria-label="Share on WhatsApp"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border p-2 hover:bg-green-100 dark:hover:bg-green-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 transition-colors"
      >
        <Phone className="size-4" />
      </a>

      {/* Telegram share */}
      <a
        href={`https://t.me/share/url?url=${encodeURIComponent(
          `/drama/${id}`
        )}&text=${encodeURIComponent(title)}`}
        aria-label="Share on Telegram"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border p-2 hover:#2299dd dark:hover:#2299dd dark:hover:bg-opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 transition-colors"
      >
        <X className="size-4" />
      </a>

      {/* X (Twitter) share */}
      <a
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
          title
        )}&url=${encodeURIComponent(`/drama/${id}`)}`}
        aria-label="Share on X"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border p-2 hover:#1da1f1 dark:hover:#1da1f1 dark:hover:bg-opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 transition-colors"
      >
        <X className="size-4" />
      </a>
    </div>
  );
}