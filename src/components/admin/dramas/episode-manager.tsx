'use client';

import type { JSX } from 'react';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import { AdminFormSelectField } from '@/components/admin/forms/admin-form-select-field';
import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import {
  VideoSourcePlaybackPreview,
  VideoSourcePreview,
  type VideoSourcePreviewState,
} from '@/components/admin/media/video-source-preview';
import { SubtitleTrackManager } from '@/components/admin/dramas/subtitle-track-manager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionError } from '@/lib/contracts/common';
import type { TableQueryState } from '@/lib/contracts/table';
import {
  episodeFormSchema,
  updateEpisodeFormSchema,
  type EpisodeDto,
} from '@/lib/contracts/episode-form';
import type { SubtitleTrackDto } from '@/lib/contracts/subtitle-track-form';
import type { SeasonDto } from '@/lib/contracts/season-form';
import {
  createEpisodeAction,
  deleteEpisodeAction,
  publishEpisodeAction,
  renumberEpisodesAction,
  reorderEpisodesAction,
  unpublishEpisodeAction,
  updateEpisodeAction,
} from '@/workflows/admin/episode-actions';
import { replaceEpisodeVideoSourceAction } from '@/workflows/admin/episode-actions';

export type EpisodeManagerProps = Readonly<{
  dramaId: string;
  structureType: string;
  seasons: readonly SeasonDto[];
  episodes: readonly EpisodeDto[];
  /** The subtitle tracks of each episode, keyed by episode id. */
  subtitleTracks: Readonly<Record<string, readonly SubtitleTrackDto[]>>;
}>;

/**
 * The replacement of an episode's video source.
 *
 * The source of an existing episode is never changed by saving the episode
 * form. Replacing it is a separate operation with its own consequences:
 * every viewer's playback position goes back to the beginning, because the
 * stored position referred to a file that is no longer served.
 *
 * The replacement is only offered after the browser has proved that the new
 * URL plays. That proof is a browser fact — the server never fetches the URL,
 * so it cannot make the same check — and it is why the administrator has to
 * watch the preview before the confirmation appears.
 */
function VideoSourceReplacement({
  episodeId,
  episodeTitle,
  currentSource,
  onReplaced,
}: Readonly<{
  episodeId: string;
  episodeTitle: string;
  currentSource: string | null;
  onReplaced: () => void;
}>): JSX.Element {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<VideoSourcePreviewState>({
    status: 'idle',
    error: null,
  });
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inputId = useId();

  const source = url.trim();
  const verified = preview.status === 'verified' && source.length > 0;

  async function confirmReplacement(): Promise<void> {
    setPending(true);
    setFailure(null);

    try {
      const result = await replaceEpisodeVideoSourceAction({
        episodeId,
        videoSource: source,
        // The browser preview verified this URL and the administrator
        // confirmed the replacement; the declaration travels with the payload.
        previewConfirmed: true,
      });

      if (!result.ok) {
        setFailure(result.error!.message);
        return;
      }

      setConfirming(false);
      setUrl('');
      setPreview({ status: 'idle', error: null });
      onReplaced();
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-label={`Video source for ${episodeTitle}`}
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <h4 className="text-sm font-medium text-foreground">Video source</h4>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Current source</p>
        <p className="break-all text-sm text-foreground">
          {currentSource ?? 'No source is set.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          New video source URL
        </label>
        <Input
          id={inputId}
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder="https://cdn.example.com/episodes/1.mp4"
          aria-describedby={`${inputId}-hint`}
        />
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          A direct absolute HTTPS URL of an MP4 file. The browser requests the file directly from
          that host; the server never fetches, proxies, or rehosts it.
        </p>
      </div>

      <VideoSourcePlaybackPreview source={source} onStateChange={setPreview} />

      {failure ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {failure}
        </div>
      ) : null}

      <Button type="button" onClick={() => setConfirming(true)} disabled={!verified || pending}>
        Replace video source
      </Button>

      <ConfirmationDialog
        open={confirming}
        onOpenChange={next => {
          if (!next) setConfirming(false);
        }}
        onConfirm={() => void confirmReplacement()}
        isPending={pending}
        error={failure}
        title={`Replace the video source for "${episodeTitle}"?`}
        description="The new source has to play in the browser before it can replace the stored one. Everything else about the episode stays as it is."
        affectedContent={<span className="break-all">{source}</span>}
        affectedContentLabel="New video source"
        consequences={
          <ul className="list-disc space-y-1 pl-4">
            <li>Every viewer&apos;s playback progress for this episode is reset to the beginning, and the episode reads as unwatched.</li>
            <li>The watch history and its dates are preserved: replacing a source does not rewrite the past.</li>
            <li>The title, description, thumbnail, hierarchy, reviews, and ratings are untouched, and no other episode is affected.</li>
            <li>The replacement is recorded in the operational records.</li>
          </ul>
        }
        consequencesLabel="Consequences"
        confirmLabel="Replace source"
        pendingLabel="Replacing…"
      />
    </section>
  );
}

export function EpisodeManager({
  dramaId,
  structureType,
  seasons,
  episodes,
  subtitleTracks,
}: EpisodeManagerProps): JSX.Element {
  const router = useRouter();
  const isFlat = structureType === 'flat';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EpisodeDto | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [createPreview, setCreatePreview] = useState<VideoSourcePreviewState>({
    status: 'idle',
    error: null,
  });

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
      <div className="space-y-4">
        <AdminForm
          schema={updateEpisodeFormSchema}
          serverAction={values => updateEpisodeAction(values)}
          defaultValues={{
            // The ids are part of the payload, not of the editable fields.
            id: row.id,
            drama_id: dramaId,
            title: row.title,
            description: row.description ?? '',
            episode_number: row.episodeNumber ?? '',
            season_id: row.seasonId ?? '',
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
          <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
            Cancel
          </Button>
        </AdminForm>

        <VideoSourceReplacement
          episodeId={row.id}
          episodeTitle={row.title}
          currentSource={row.videoSource ?? null}
          onReplaced={() => router.refresh()}
        />

        <SubtitleTrackManager
          episodeId={row.id}
          episodeTitle={row.title}
          tracks={subtitleTracks[row.id] ?? []}
        />
      </div>
    );
  }

  function renderActions(row: EpisodeDto, index: number): JSX.Element {
    const isPublished = row.publicationStatus === 'published';

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
        {isPublished ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              await run(`unpublish:${row.id}`, () => unpublishEpisodeAction({ id: row.id }));
            }}
            disabled={pending !== null}
          >
            Unpublish
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={async () => {
              await run(`publish:${row.id}`, () => publishEpisodeAction({ id: row.id }));
            }}
            disabled={pending !== null}
          >
            Publish
          </Button>
        )}
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
          serverAction={values => createEpisodeAction(values)}
          defaultValues={{ dramaId, title: '', description: '', episode_number: '', season_id: '', video_source: '' }}
          submitLabel="Add episode"
          // A source is only stored after the browser proved that it plays, so
          // the episode cannot be saved while the preview is unverified.
          submitDisabled={createPreview.status === 'loading' || createPreview.status === 'failed'}
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
          <VideoSourcePreview onStateChange={setCreatePreview} />
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
