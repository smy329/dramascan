import type { JSX } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export type LoadingIndicatorVariant = 'inline' | 'block';
export type LoadingIndicatorSize = 'sm' | 'md' | 'lg';

const LAYOUT_CLASSES: Record<LoadingIndicatorVariant, string> = {
  inline: 'inline-flex items-center gap-2',
  block: 'flex w-full flex-col items-center justify-center gap-2 py-8',
};

const SPINNER_SIZE_CLASSES: Record<LoadingIndicatorSize, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
};

export type LoadingIndicatorProps = Readonly<{
  variant?: LoadingIndicatorVariant;
  size?: LoadingIndicatorSize;
  label?: string;
  className?: string;
}>;

/**
 * Communicates an in-progress operation through one polite status region. The
 * spinner is decorative; the accessible name comes from the hidden label.
 */
export function LoadingIndicator({
  variant = 'inline',
  size = 'md',
  label = 'Loading',
  className,
}: LoadingIndicatorProps): JSX.Element {
  return (
    <div
      data-slot="loading-indicator"
      role="status"
      aria-live="polite"
      className={cn(LAYOUT_CLASSES[variant], className)}
    >
      <Loader2
        aria-hidden="true"
        className={cn('animate-spin motion-reduce:animate-none', SPINNER_SIZE_CLASSES[size])}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
