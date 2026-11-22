'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { Button } from '@/components/ui/button';
import { deleteDramaAction } from '@/workflows/admin/drama-actions';

export type DramaTrashButtonProps = Readonly<{
  dramaId: string;
  title: string;
  /** The number of seasons and episodes the drama would take into the Trash. */
  affectedSeasons?: number;
  affectedEpisodes?: number;
}>;

/**
 * Move one drama to Trash.
 *
 * The dialog names the affected child records before the operation, because a
 * drama carries its seasons and episodes into the Trash with it.
 */
export function DramaTrashButton({
  dramaId,
  title,
  affectedSeasons = 0,
  affectedEpisodes = 0,
}: DramaTrashButtonProps): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function moveToTrash(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      const result = await deleteDramaAction(dramaId);

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

  const affected = affectedSeasons + affectedEpisodes;

  return (
    <>
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
        description="The drama stays recoverable until the retention period expires."
        affectedContent={
          affected > 0
            ? `${affectedSeasons} season(s) and ${affectedEpisodes} episode(s) move into the Trash with it.`
            : 'No season or episode is affected.'
        }
        affectedContentLabel="Affected content"
        consequences="The drama leaves the public catalogue immediately. Restoring it restores the hierarchy that was trashed with it."
        confirmLabel="Move to Trash"
        pendingLabel="Moving…"
        variant="destructive"
        isPending={pending}
        error={error}
        onConfirm={() => void moveToTrash()}
      />
    </>
  );
}
