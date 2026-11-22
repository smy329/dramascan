'use client';

import type { JSX } from 'react';
import { useFormContext } from 'react-hook-form';

/**
 * Browser playback preview for the administrator-supplied direct MP4 URL.
 *
 * The URL is handed to the browser as-is. The server never fetches it, so this
 * preview is the only proof that the source actually plays: the external host
 * has to allow CORS and byte-range requests for playback and seeking to work.
 */
export function VideoSourcePreview({
  name = 'video_source',
}: Readonly<{ name?: string }>): JSX.Element | null {
  const { watch } = useFormContext<Record<string, unknown>>();
  const value = watch(name);
  const source = typeof value === 'string' ? value.trim() : '';

  if (source.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Playback preview</p>
      <video
        key={source}
        controls
        preload="metadata"
        src={source}
        className="max-h-72 w-full rounded-lg border border-border bg-black"
      >
        Your browser cannot play this source.
      </video>
      <p className="text-xs text-muted-foreground">
        The browser requests the file directly from the external host. The host must allow CORS
        and byte-range requests.
      </p>
    </div>
  );
}
