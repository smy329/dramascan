import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type ConsequenceListProps = Readonly<{
  items: ReactNode[];
  label?: string;
  className?: string;
}>;

function renderItem(item: ReactNode, index: number): JSX.Element {
  return <li key={index}>{item}</li>;
}

/**
 * Presents the consequences of a consequential operation as a real list.
 * Styling is neutral: a publish or a restore is described as validly as a
 * deletion. The caller supplies the copy.
 */
export function ConsequenceList({
  items,
  label,
  className,
}: ConsequenceListProps): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul
      data-slot="consequence-list"
      aria-label={label}
      className={cn(
        'list-disc space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-muted-foreground/70',
        className
      )}
    >
      {items.map(renderItem)}
    </ul>
  );
}
