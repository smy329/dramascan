'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { Film } from 'lucide-react';

type ContentPosterProps = Readonly<{
  src: string | null;
}>;

function PosterImage({ src, onError }: { src: string; onError: () => void }): JSX.Element {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={onError}
      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
    />
  );
}

function PosterPlaceholder(): JSX.Element {
  return (
    <div
      data-slot="content-poster-placeholder"
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(226,61,92,0.18),transparent_55%)]"
    >
      <Film className="size-8 text-muted-foreground/60" />
    </div>
  );
}

function renderPosterContent(
  showImage: boolean,
  src: string | null,
  onError: () => void
): JSX.Element {
  if (showImage && src !== null) {
    return <PosterImage src={src} onError={onError} />;
  }

  return <PosterPlaceholder />;
}

/**
 * Poster image island. Plain `<img>` is intentional: the project does not use
 * Next.js image optimization or Sharp. The failed source is tracked so a new
 * poster URL retries instead of inheriting the previous failure.
 */
export function ContentPoster({ src }: ContentPosterProps): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src !== null && failedSrc !== src;

  return (
    <div
      data-slot="content-poster"
      className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-border/70 bg-muted"
    >
      {renderPosterContent(showImage, src, () => setFailedSrc(src))}
    </div>
  );
}
