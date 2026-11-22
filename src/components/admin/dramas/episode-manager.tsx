'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import { AdminFormSelectField } from '@/components/admin/forms/admin-form-select-field';
import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { VideoSourcePreview } from '@/components/admin/media/video-source-preview';
import { Button } from '@/components/ui/button';
import type { ActionError } from '@/lib/contracts/common';
import type { TableQueryState } from '@/lib/contracts/table';
import {
  episodeFormSchema,
  updateEpisodeFormSchema,
  type EpisodeDto,
} from '@/lib/contracts/episode-form';
import type { SeasonDto } from '@/lib/contracts/season-form';
import {
  createEpisodeAction,
  deleteEpisodeAction,
  renumberEpisodesAction,
  reorderEpisodesAction,
  updateEpisodeAction,
} from '@/workflows/admin/episode-actions';

export type EpisodeManagerProps = Readonly<{
  dramaId: string;
  structureType: string;
  seasons: readonly SeasonDto[];
  episodes: readonly EpisodeDto[];
}>;

export function EpisodeManager({
  dramaId,
  structureType,
  seasons,
  episodes,
}: EpisodeManagerProps): JSX.Element {
  const router = useRouter();
  const isFlat = structureType === 'flat';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EpisodeDto | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const state: TableQueryState = {
    page: 1,
    pageSize: Math.max(episodes.length, 1),
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
    if (swap < 0 || swap >= episodes.length) return;

    const ordered = [...episodes];
    const moving = ordered[index]!;
    ordered[index] = ordered[swap]!;
    ordered[swap] = moving;

    const ids = ordered.map(row => row.id);
    void run(`move:${moving.id}`, () => reorderEpisodesAction({ drama_id: dramaId, ids }));
  }

  function confirmDelete(): void {
    const target = deleting;
    if (!target) return;

    setDeleting(null);
    void run(`delete:${target.id}`, () => deleteEpisodeAction({ id: target.id }));
  }

  const seasonOptions = [
    { value: '', label: 'No season (flat or unassigned)' },
    ...seasons.map(s => ({ value: s.id, label: s.title })),
  ];

  function renderEditForm(row: EpisodeDto): JSX.Element {
    return (
      <AdminForm
        schema={updateEpisodeFormSchema}
        serverAction={values => {
          const v = values as Record<string, unknown>;
          const payload: Record<string, unknown> = {
            id: row.id,
            drama_id: dramaId,
            title: v.title,
            description: v.description,
            episode_number: v.episode_number,
            video_source: v.video_source,
          };
          if (!isFlat) {
            payload.season_id = v.season_id === '' ? undefined : v.season_id;
          }
          return updateEpisodeAction(payload);
        }}
        defaultValues={{
          title: row.title,
          description: row.description ?? '',
          episode_number: row.episodeNumber ?? '',
          season_id: row.seasonId ?? '',
          video_source: row.videoSource ?? '',
        }}
        resetOnSuccess={false}
        submitLabel="Save changes"
        onSuccess={() => {
          setEditingId(null);
          router.refresh();
        }}
      >
        <AdminFormField name="title" label="Title" required />
        <AdminFormField name="description" label="Description" multiline />
        <AdminFormField name="episode_number" label="Episode Number" type="number" />
        {!isFlat ? (
          <AdminFormSelectField name="season_id" label="Season" options={seasonOptions} />
        ) : null}
        <AdminFormField
          name="video_source"
          label="Video Source (HTTPS MP4)"
          hint="Direct absolute HTTPS URL ending in .mp4"
        />
        <VideoSourcePreview />
        <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
          Cancel
        </Button>
      </AdminForm>
    );
  }

  function renderActions(row: EpisodeDto, index: number): JSX.Element {
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
          disabled={index === episodes.length - 1 || pending !== null}
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

  const columns: AdminTableColumn<EpisodeDto>[] = [
    {
      key: 'number',
      header: 'No.',
      render: row => <span className="font-medium text-foreground">{row.episodeNumber ?? '—'}</span>,
    },
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
      key: 'publicationStatus',
      header: 'Status',
      render: row => <span className="capitalize text-muted-foreground">{row.publicationStatus ?? 'draft'}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: row => renderActions(row, episodes.indexOf(row)),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">Episodes</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void run('renumber', () => renumberEpisodesAction({ drama_id: dramaId }))}
          disabled={pending !== null || episodes.length === 0}
        >
          Renumber Episodes
        </Button>
      </div>

      <section aria-labelledby="new-episode-heading" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 id="new-episode-heading" className="text-sm font-medium text-foreground">
          New Episode
        </h2>
        <AdminForm
          schema={episodeFormSchema}
          serverAction={values => {
            const v = values as Record<string, unknown>;
            const payload: Record<string, unknown> = {
              dramaId,
              title: v.title,
              description: v.description,
              episode_number: v.episode_number,
              video_source: v.video_source,
            };
            if (!isFlat) {
              payload.season_id = v.season_id === '' ? undefined : v.season_id;
            }
            return createEpisodeAction(payload);
          }}
          defaultValues={{ dramaId, title: '', description: '', episode_number: '', season_id: '', video_source: '' }}
          submitLabel="Add episode"
          onSuccess={() => router.refresh()}
        >
          <AdminFormField name="title" label="Title" required />
          <AdminFormField name="description" label="Description" multiline />
          <AdminFormField name="episode_number" label="Episode Number" type="number" hint="Leave blank to auto-number" />
          {!isFlat ? (
            <AdminFormSelectField name="season_id" label="Season" options={seasonOptions} />
          ) : null}
          <AdminFormField
            name="video_source"
            label="Video Source (HTTPS MP4)"
            hint="Direct absolute HTTPS URL ending in .mp4"
          />
          <VideoSourcePreview />
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
        caption="Episodes"
        columns={columns}
        rows={episodes}
        rowKey={row => row.id}
        pathname={`/admin/dramas/${dramaId}`}
        state={state}
        empty={
          <p className="text-sm text-muted-foreground">No episodes created yet.</p>
        }
      />

      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={next => {
          if (!next) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        isPending={pending !== null}
        title={`Delete episode ${deleting?.title ?? ''}?`}
        description="The episode moves to the Trash."
        variant="destructive"
        confirmLabel="Delete"
        pendingLabel="Deleting…"
      />
    </div>
  );
}
