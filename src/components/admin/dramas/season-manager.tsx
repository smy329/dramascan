'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { Button } from '@/components/ui/button';
import type { ActionError } from '@/lib/contracts/common';
import type { TableQueryState } from '@/lib/contracts/table';
import {
  seasonFormSchema,
  updateSeasonFormSchema,
  type SeasonDto,
} from '@/lib/contracts/season-form';
import {
  createSeasonAction,
  deleteSeasonAction,
  reorderSeasonsAction,
  updateSeasonAction,
} from '@/workflows/admin/season-actions';

export type SeasonManagerProps = Readonly<{
  dramaId: string;
  structureType: string;
  seasons: readonly SeasonDto[];
}>;

export function SeasonManager({
  dramaId,
  structureType,
  seasons,
}: SeasonManagerProps): JSX.Element {
  const router = useRouter();
  const isFlat = structureType === 'flat';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SeasonDto | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const state: TableQueryState = {
    page: 1,
    pageSize: Math.max(seasons.length, 1),
    sort: '',
    search: '',
    filters: {},
  };

  async function run(
    key: string,
    operation: () => Promise<{ ok: true; data: unknown } | { ok: false; error: ActionError }>
  ): Promise<void> {
    setPending(key);
    setFailure(null);

    try {
      const result = await operation();

      if (!result.ok) {
        setFailure(result.error!.message);
        return;
      }

      router.refresh();
    } finally {
      setPending(null);
    }
  }

  function move(index: number, direction: -1 | 1): void {
    const swap = index + direction;
    if (swap < 0 || swap >= seasons.length) return;

    const ordered = [...seasons];
    const moving = ordered[index]!;
    ordered[index] = ordered[swap]!;
    ordered[swap] = moving;

    const ids = ordered.map(row => row.id);
    void run(`move:${moving.id}`, () => reorderSeasonsAction({ drama_id: dramaId, ids }));
  }

  function confirmDelete(): void {
    const target = deleting;
    if (!target) return;

    setDeleting(null);
    void run(`delete:${target.id}`, () => deleteSeasonAction({ id: target.id }));
  }

  function renderEditForm(row: SeasonDto): JSX.Element {
    return (
      <AdminForm
        schema={updateSeasonFormSchema}
        serverAction={values => updateSeasonAction({ id: row.id, ...(values as Record<string, unknown>) })}
        defaultValues={{ title: row.title }}
        resetOnSuccess={false}
        submitLabel="Save changes"
        onSuccess={() => {
          setEditingId(null);
          router.refresh();
        }}
      >
        <AdminFormField name="title" label="Title" required />
        <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
          Cancel
        </Button>
      </AdminForm>
    );
  }

  function renderActions(row: SeasonDto, index: number): JSX.Element {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => move(index, -1)}
          disabled={index === 0 || pending !== null}
          aria-label={`Move ${row.title} up`}
        >
          ↑
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => move(index, 1)}
          disabled={index === seasons.length - 1 || pending !== null}
          aria-label={`Move ${row.title} down`}
        >
          ↓
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditingId(editingId === row.id ? null : row.id)}
          disabled={pending !== null}
        >
          {editingId === row.id ? 'Close' : 'Edit'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => setDeleting(row)}
          disabled={pending !== null}
        >
          Delete
        </Button>
      </div>
    );
  }

  const columns: AdminTableColumn<SeasonDto>[] = [
    {
      key: 'title',
      header: 'Title',
      render: row => {
        if (editingId === row.id) {
          return renderEditForm(row);
        }

        return <span className="font-medium text-foreground">{row.title}</span>;
      },
    },
    {
      key: 'episodes',
      header: 'Episodes',
      render: row => <span className="text-muted-foreground">{row.episodeCount ?? 0}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: row => renderActions(row, seasons.indexOf(row)),
    },
  ];

  if (isFlat) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground space-y-2">
        <h2 className="font-medium text-foreground">Season Structure: Flat Drama</h2>
        <p>
          This drama is configured as a single flat list of episodes without seasons.
          To add multiple seasons, edit the drama settings to change its structure type to
          &quot;Season-based&quot;.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="new-season-heading" className="space-y-3">
        <h2 id="new-season-heading" className="text-sm font-medium text-foreground">
          New Season
        </h2>
        <AdminForm
          schema={seasonFormSchema}
          serverAction={values => createSeasonAction({ dramaId, ...(values as Record<string, unknown>) })}
          defaultValues={{ title: '' }}
          submitLabel="Add season"
          onSuccess={() => router.refresh()}
        >
          <AdminFormField name="title" label="Title" required />
        </AdminForm>
      </section>

      {failure ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {failure}
        </div>
      ) : null}

      <AdminDataTable
        caption="Seasons"
        columns={columns}
        rows={seasons}
        rowKey={row => row.id}
        pathname={`/admin/dramas/${dramaId}`}
        state={state}
        empty={
          <p className="text-sm text-muted-foreground">No seasons created yet.</p>
        }
      />

      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={next => {
          if (!next) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        isPending={pending !== null}
        title={`Delete ${deleting?.title ?? ''}?`}
        description="The season moves to the Trash."
        affectedContent={
          <>
            Contains <strong>{deleting?.episodeCount ?? 0}</strong>{' '}
            {deleting?.episodeCount === 1 ? 'episode' : 'episodes'} which will also be trashed.
          </>
        }
        affectedContentLabel="Affected content"
        variant="destructive"
        confirmLabel="Delete"
        pendingLabel="Deleting…"
      />
    </div>
  );
}
