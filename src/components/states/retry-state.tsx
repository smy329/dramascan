import type { JSX, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { resolveHeadingTag, type HeadingLevel } from '@/components/states/heading';
import { cn } from '@/lib/utils';

export type RetryStateProps = Readonly<{
  title: string;
  description?: string;
  children?: ReactNode;
  icon?: LucideIcon;
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
 * Failure block for an operation that has stopped or errored. It is a server
 * component with `role="alert"`; the caller supplies a link, a Server Action
 * form, or a client wrapper around `RetryButton` as the action.
 */
export function RetryState({
  title,
  description,
  children,
  icon: Icon = AlertTriangle,
  headingLevel,
  className,
}: RetryStateProps): JSX.Element {
  const Heading = resolveHeadingTag(headingLevel);

  return (
    <div
      data-slot="retry-state"
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-destructive/40 bg-destructive/5 px-6 py-14 text-center',
        className
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <Heading className="mt-5 text-base font-medium text-foreground">{title}</Heading>
      {renderDescription(description)}
      {renderAction(children)}
    </div>
  );
}
