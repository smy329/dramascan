import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type SkeletonVariant = 'text' | 'circle' | 'rectangle';

const SKELETON_VARIANT_CLASSES: Record<SkeletonVariant, string> = {
  text: 'h-4 w-full rounded',
  circle: 'size-10 shrink-0 rounded-full',
  rectangle: 'h-24 w-full rounded-xl',
};

export type SkeletonProps = Readonly<{
  variant?: SkeletonVariant;
  className?: string;
}>;

/**
 * Decorative placeholder bone. It never renders text or an accessible name;
 * callers compose it inside `SkeletonGroup`, which owns the announcement.
 */
export function Skeleton({ variant = 'text', className }: SkeletonProps): JSX.Element {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-muted motion-reduce:animate-none',
        SKELETON_VARIANT_CLASSES[variant],
        className
      )}
    />
  );
}

export type SkeletonGroupProps = Readonly<{
  label?: string;
  className?: string;
  children: ReactNode;
}>;

/**
 * Wraps repeated skeletons and announces loading exactly once. The group does
 * not impose a layout; compose grids or lists through `className`.
 */
export function SkeletonGroup({
  label = 'Loading content',
  className,
  children,
}: SkeletonGroupProps): JSX.Element {
  return (
    <div data-slot="skeleton-group" role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
