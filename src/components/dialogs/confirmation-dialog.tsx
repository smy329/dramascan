'use client';

import { useId, useRef, type JSX, type ReactElement, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';

import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export type ConfirmationVariant = 'default' | 'destructive';

export type ConfirmationDialogProps = Readonly<{
  open?: boolean;
  onOpenChange?: (_nextOpen: boolean) => void;
  defaultOpen?: boolean;
  onConfirm: () => void;
  isPending?: boolean;
  title: string;
  description?: ReactNode;
  affectedContent?: ReactNode;
  affectedContentLabel?: string;
  consequences?: ReactNode;
  consequencesLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingLabel?: string;
  variant?: ConfirmationVariant;
  trigger?: ReactElement;
  className?: string;
}>;

function renderDescription(description?: ReactNode): JSX.Element | null {
  if (!description) {
    return null;
  }

  return <AlertDialogDescription>{description}</AlertDialogDescription>;
}

function renderMedia(variant: ConfirmationVariant): JSX.Element | null {
  if (variant !== 'destructive') {
    return null;
  }

  return (
    <AlertDialogMedia className="text-destructive">
      <AlertTriangle aria-hidden="true" />
    </AlertDialogMedia>
  );
}

function renderSpinner(isPending: boolean): JSX.Element | null {
  if (!isPending) {
    return null;
  }

  return <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
}

type SectionProps = Readonly<{
  id: string;
  label: string;
  children: ReactNode;
  panel?: boolean;
}>;

function renderSection({ id, label, children, panel = false }: SectionProps): JSX.Element {
  return (
    <section
      aria-labelledby={id}
      className={panel ? 'rounded-lg border border-border bg-muted/40 p-3 text-left' : 'text-left'}
    >
      <h3 id={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <div className={panel ? 'mt-2 text-sm text-foreground' : 'mt-2'}>{children}</div>
    </section>
  );
}

/**
 * Presents a consequential operation for explicit confirmation. The caller
 * owns the open state and the operation; this component only reports the
 * request. Cancel is focused first because it is the safe action.
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  defaultOpen,
  onConfirm,
  isPending = false,
  title,
  description,
  affectedContent,
  affectedContentLabel = 'Affected content',
  consequences,
  consequencesLabel = 'Consequences',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  pendingLabel = 'Working…',
  variant = 'default',
  trigger,
  className,
}: ConfirmationDialogProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const affectedHeadingId = useId();
  const consequencesHeadingId = useId();

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen && isPending) {
      return;
    }

    onOpenChange?.(nextOpen);
  }

  function handleConfirm(): void {
    if (isPending) {
      return;
    }

    onConfirm();
  }

  return (
    <AlertDialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={handleOpenChange}
    >
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogContent initialFocus={cancelRef} className={className}>
        <AlertDialogHeader>
          {renderMedia(variant)}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {renderDescription(description)}
        </AlertDialogHeader>
        {affectedContent
          ? renderSection({
              id: affectedHeadingId,
              label: affectedContentLabel,
              children: affectedContent,
              panel: true,
            })
          : null}
        {consequences
          ? renderSection({
              id: consequencesHeadingId,
              label: consequencesLabel,
              children: consequences,
            })
          : null}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={isPending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogPrimitive.Close
            onClick={handleConfirm}
            render={
              <Button
                data-slot="confirmation-dialog-confirm"
                variant={variant === 'destructive' ? 'destructive' : 'default'}
                disabled={isPending}
                aria-busy={isPending ? true : undefined}
              />
            }
          >
            {renderSpinner(isPending)}
            {isPending ? pendingLabel : confirmLabel}
          </AlertDialogPrimitive.Close>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogPrimitive.Root>
  );
}
