import type { JSX, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { resolveHeadingTag, type HeadingLevel } from '@/components/states/heading';
import { cn } from '@/lib/utils';

export type EmptyStateProps = Readonly<{
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  headingLevel?: HeadingLevel;
  className?: string;
}>;

function renderDescription(description?: string): JSX.Element | null {
  if (!description) {
    return null;
  }

  return (
    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
  );
}

function renderAction(children?: ReactNode): JSX.Element | null {
  if (!children) {
    return null;
  }

  return <div className="mt-6">{children}</div>;
}

/**
 * Consistent "nothing to show" block. The caller supplies the action through
 * `children`; the component only presents it.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  headingLevel,
  className,
}: EmptyStateProps): JSX.Element {
  const Heading = resolveHeadingTag(headingLevel);

  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center',
        className
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <Heading className="mt-5 text-base font-medium text-foreground">{title}</Heading>
      {renderDescription(description)}
      {renderAction(children)}
    </div>
  );
}
