'use client';

import type { JSX } from 'react';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormContext } from 'react-hook-form';

import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import { AdminFormSelectField } from '@/components/admin/forms/admin-form-select-field';
import { Button } from '@/components/ui/button';
import { subtitleTrackFormSchema, type SubtitleTrackDto } from '@/lib/contracts/subtitle-track-form';
import {
  deleteSubtitleTrackAction,
  upsertSubtitleTrackAction,
} from '@/workflows/admin/playback-actions';

/**
 * Administration of the subtitle tracks of one episode.
 *
 * A track is metadata: a language, a label the player shows, the format, and
 * the direct HTTPS URL the browser fetches the file from. The server never
 * downloads, converts, or rehosts a subtitle file, so the URL is the whole
 * contract with the external host.
 *
 * There is one track per language per episode: adding a track for a language
 * that already has one replaces it instead of stacking duplicates.
 */

export type SubtitleTrackManagerProps = Readonly<{
  episodeId: string;
  episodeTitle: string;
  tracks: readonly SubtitleTrackDto[];
}>;

/** The formats the player understands. */
const FORMAT_OPTIONS = [
  { value: 'vtt', label: 'VTT (WebVTT)' },
  { value: 'srt', label: 'SRT (SubRip)' },
  { value: 'ssa', label: 'SSA (SubStation Alpha)' },
  { value: 'ass', label: 'ASS (Advanced SubStation Alpha)' },
  { value: 'json', label: 'JSON' },
];

/**
 * The "default track" checkbox.
 *
 * The shared form shell has no checkbox field, so the control registers itself
 * against the form context. React Hook Form turns a registered checkbox into
 * a boolean, which is what the contract expects.
 */
function DefaultTrackField(): JSX.Element {
  const { register } = useFormContext<Record<string, unknown>>();
  const id = useId();

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-foreground">
        <input
          id={id}
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          {...register('isDefault')}
        />
        Default track
      </label>
      <p className="text-xs text-muted-foreground">
        The player selects this track when the episode starts.
      </p>
    </div>
  );
}

export function SubtitleTrackManager({
  episodeId,
  episodeTitle,
  tracks,
}: SubtitleTrackManagerProps): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function removeTrack(track: SubtitleTrackDto): Promise<void> {
    setPending(true);
    setFailure(null);

    try {
      const result = await deleteSubtitleTrackAction({
        episodeId,
        trackId: track.id,
      });

      if (!result.ok) {
        setFailure(result.error!.message);
        return;
      }

      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-label={`Subtitles for ${episodeTitle}`}
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <h4 className="text-sm font-medium text-foreground">Subtitles</h4>

      <p className="text-xs text-muted-foreground">
        The browser fetches every subtitle file directly from its external host. The server
        never downloads, converts, or rehosts a subtitle file.
      </p>

      {failure ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {failure}
        </div>
      ) : null}

      {tracks.length === 0 ? (
        <p className="text-sm text-muted-foreground">This episode has no subtitle tracks yet.</p>
      ) : (
        <ul className="space-y-2">
          {tracks.map(track => (
            <li
              key={track.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-2"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{track.label}</span>
                  <span className="text-xs text-muted-foreground">{track.language}</span>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {track.format}
                  </span>
                  {track.isDefault ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground">
                      Default
                    </span>
                  ) : null}
                </div>
                <p className="break-all text-xs text-muted-foreground">{track.sourceUrl}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => void removeTrack(track)}
                disabled={pending}
                aria-label={`Remove the ${track.label} subtitle track`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AdminForm
        schema={subtitleTrackFormSchema}
        serverAction={values => upsertSubtitleTrackAction(values)}
        defaultValues={{
          episodeId,
          language: '',
          label: '',
          sourceUrl: '',
          format: 'vtt',
          isDefault: false,
        }}
        submitLabel="Add subtitle track"
        onSuccess={() => router.refresh()}
      >
        <AdminFormField
          name="language"
          label="Language"
          required
          hint="BCP 47 language tag, for example en or pt-BR"
        />
        <AdminFormField
          name="label"
          label="Label"
          required
          hint="Shown in the player, for example English"
        />
        <AdminFormSelectField name="format" label="Format" options={FORMAT_OPTIONS} required />
        <AdminFormField
          name="sourceUrl"
          label="Source URL"
          required
          hint="Direct absolute HTTPS URL of the subtitle file, ending in the selected format"
        />
        <DefaultTrackField />
      </AdminForm>
    </section>
  );
}
