'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { Button } from '@/components/ui/button';
import { deleteMovieAction } from '@/workflows/admin/movie-actions';

export type MovieRowActionsProps = Readonly<{
  movieId: string;
  title: string;
}>;

/** Edit and Trash controls for one movie row. */
export function MovieRowActions({ movieId, title }: MovieRowActionsProps): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function moveToTrash(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      const result = await deleteMovieAction(movieId);

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-3">
      <Link
        href={`/admin/movies/${movieId}/edit`}
        className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
      >
        Edit
      </Link>
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-sm text-destructive"
        onClick={() => setOpen(true)}
      >
        Move to Trash
      </Button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title={`Move “${title}” to Trash?`}
        description="The movie stays recoverable until the retention period expires."
        consequences="The movie leaves the public catalogue immediately. Ratings and reviews remain until permanent deletion."
        confirmLabel="Move to Trash"
        pendingLabel="Moving…"
        variant="destructive"
        isPending={pending}
        error={error}
        onConfirm={() => void moveToTrash()}
      />
    </div>
  );
}
