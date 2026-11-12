import type { JSX } from 'react';

import { Skeleton, SkeletonGroup } from '@/components/states/skeleton';

export type AdminTableSkeletonProps = Readonly<{
  columns: number;
  label?: string;
  className?: string;
}>;

/**
 * Loading placeholder for a data table. The bones are decorative; the group
 * owns the single loading announcement.
 */
export function AdminTableSkeleton({
  columns,
  label = 'Loading table',
  className,
}: AdminTableSkeletonProps): JSX.Element {
  return (
    <SkeletonGroup label={label} className={className}>
      <div className="space-y-2">
        {Array.from({ length: columns }, (_, index) =>
          <div key={index} className="flex gap-3">
            {Array.from({ length: 5 }, (__, cellIndex) =>
              <Skeleton key={cellIndex} className="h-8 flex-1" />
            )}
          </div>
        )}
      </div>
    </SkeletonGroup>
  );
}
