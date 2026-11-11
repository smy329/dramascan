import type { JSX } from 'react';

import { Skeleton } from '@/components/states/skeleton';
import { cn } from '@/lib/utils';

export type ContentCardSkeletonProps = Readonly<{
  className?: string;
}>;

/**
 * Loading counterpart of `ContentCard`. It mirrors the 2:3 poster, rounded
 * frame, gap, and metadata rhythm so the swap to real content does not shift
 * layout. The whole block is decorative; wrap groups in `SkeletonGroup`.
 */
export function ContentCardSkeleton({ className }: ContentCardSkeletonProps): JSX.Element {
  return (
    <div
      data-slot="content-card-skeleton"
      aria-hidden="true"
      className={cn('flex w-full min-w-0 flex-col gap-3', className)}
    >
      <div
        data-slot="content-card-skeleton-poster"
        className="aspect-[2/3] w-full animate-pulse rounded-xl border border-border/70 bg-muted motion-reduce:animate-none"
      />
      <div className="min-w-0 space-y-1.5">
        <Skeleton variant="text" className="w-4/5" />
        <Skeleton variant="text" className="w-3/5" />
        <Skeleton variant="text" className="h-3 w-20" />
      </div>
    </div>
  );
}
