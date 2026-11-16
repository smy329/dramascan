'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type JSX } from 'react';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { Button } from '@/components/ui/button';
import type {
  MovieConversionApplyResultDto,
  MovieConversionPreviewDto,
} from '@/lib/contracts/drama-movie-conversion';

import {
  applyDramaMovieConversion,
  previewDramaMovieConversion,
} from '@/workflows/admin/movie-conversion-actions';

export type DramaMovieConversionPanelProps = Readonly<{
  dramaId: string;
  dramaTitle: string;
  eligible: boolean;
  ineligibilityReason: string | null;
  episodeTitle: string | null;
  activeEpisodeCount: number;
}>;

function formatCount(value: number): string {
  return value === 0 ? 'None' : String(value);
}

/**
 * Interactive drama → movie conversion panel.
 *
 * The panel never decides whether a conversion is allowed: it asks the server
 * for a preview and applies the exact previewed plan through the Server Action.
 * The fingerprint returned by the preview is echoed back on apply, so any edit
 * between preview and confirmation is rejected server-side.
 */
export function DramaMovieConversionPanel({
  dramaId,
  dramaTitle,
  eligible,
  ineligibilityReason,
  episodeTitle,
  activeEpisodeCount,
}: DramaMovieConversionPanelProps): JSX.Element {
  const router = useRouter();
  const headingId = useId();
  const previewId = useId();

  const [plan, setPlan] = useState<MovieConversionPreviewDto | null>(null);
  const [result, setResult] = useState<MovieConversionApplyResultDto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  async function handlePreview(): Promise<void> {
    setIsPreviewing(true);
    setErrorMessage(null);
    setResult(null);

    const response = await previewDramaMovieConversion(dramaId);

    setIsPreviewing(false);

    if (!response.ok) {
      setPlan(null);
      setErrorMessage(response.error.message);
      return;
    }

    setPlan(response.data);
  }

  async function handleApply(): Promise<void> {
    if (!plan) {
      return;
    }

    setIsApplying(true);
    setErrorMessage(null);

    const response = await applyDramaMovieConversion(dramaId, plan.fingerprint);

    setIsApplying(false);

    if (!response.ok) {
      setErrorMessage(response.error.message);
      return;
    }

    setIsConfirmOpen(false);
    setPlan(null);
    setResult(response.data);
    router.refresh();
  }

  return (
    <div className="space-y-6" data-slot="drama-movie-conversion-panel">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Convert “{dramaTitle}” to a movie
        </h1>
        <p id={headingId} className="mt-1 text-sm text-muted-foreground">
          A drama can become a standalone movie only when it has exactly one active episode.
          The drama currently has {activeEpisodeCount} active episode
          {activeEpisodeCount === 1 ? '' : 's'}.
        </p>
      </div>

      {!eligible ?
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-foreground">{ineligibilityReason}</p>
        </div>
       : null}

      {result ?
        <div role="status" className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium text-foreground">
            “{result.movie.title}” was created as a standalone movie.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Slug: {result.movie.slug} · Movie ID: {result.movieId}
          </p>
        </div>
       : null}

      {errorMessage ?
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-foreground">{errorMessage}</p>
        </div>
       : null}

      {eligible && !result ?
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handlePreview} disabled={isPreviewing || isApplying}>
            {isPreviewing ? 'Building preview…' : 'Preview conversion'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsConfirmOpen(true)}
            disabled={plan === null || isPreviewing || isApplying}
          >
            Convert to movie
          </Button>
        </div>
       : null}

      <section aria-live="polite" aria-labelledby={previewId}>
        <h2 id={previewId} className="text-sm font-medium text-foreground">
          Preview
        </h2>

        {plan ?
          <div className="mt-3 space-y-5">
            <p className="text-sm text-muted-foreground">
              Source episode: {plan.source.episodeTitle}
              {plan.source.episodeNumber === null ? '' : ` (episode ${plan.source.episodeNumber})`}
            </p>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Title
                </dt>
                <dd className="text-sm text-foreground">{plan.movie.title}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Slug
                </dt>
                <dd className="text-sm text-foreground">{plan.movie.slug}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Publication state
                </dt>
                <dd className="text-sm text-foreground">{plan.movie.publicationStatus}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Video source
                </dt>
                <dd className="break-all text-sm text-foreground">
                  {plan.movie.videoSource ?? 'None'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </dt>
                <dd className="text-sm text-foreground">{plan.movie.description ?? 'None'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Poster
                </dt>
                <dd className="break-all text-sm text-foreground">{plan.movie.poster ?? 'None'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Banner
                </dt>
                <dd className="break-all text-sm text-foreground">{plan.movie.banner ?? 'None'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Categories
                </dt>
                <dd className="text-sm text-foreground">
                  {plan.movie.categories.length === 0
                    ? 'None'
                    : plan.movie.categories.map(category => category.name).join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Platforms
                </dt>
                <dd className="text-sm text-foreground">
                  {plan.movie.platforms.length === 0
                    ? 'None'
                    : plan.movie.platforms.map(platform => platform.name).join(', ')}
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="text-sm font-medium text-foreground">Relationships that move</h3>
              <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                <li>Ratings: {formatCount(plan.relationships.ratings)}</li>
                <li>Reviews: {formatCount(plan.relationships.reviews)}</li>
                <li>Bookmarks: {formatCount(plan.relationships.bookmarks)}</li>
                <li>Playback progress: {formatCount(plan.relationships.playbackProgress)}</li>
                <li>Watched state: {formatCount(plan.relationships.watchedState)}</li>
                <li>Watch history: {formatCount(plan.relationships.watchHistory)}</li>
                <li>Categories: {formatCount(plan.relationships.categories)}</li>
                <li>Platforms: {formatCount(plan.relationships.platforms)}</li>
                <li>Analytics records: {formatCount(plan.relationships.analyticsEvents)}</li>
                <li>Notifications: {formatCount(plan.relationships.notifications)}</li>
              </ul>
            </div>

            {plan.warnings.length > 0 ?
              <ul className="space-y-1 text-sm text-muted-foreground">
                {plan.warnings.map(warning =>
                  <li key={warning}>{warning}</li>
                )}
              </ul>
             : null}
          </div>
         : !result ?
          <p className="mt-2 text-sm text-muted-foreground">
            Preview the conversion to see the resulting movie before confirming.
          </p>
         : null}
      </section>

      {plan ?
        <ConfirmationDialog
          open={isConfirmOpen}
          onOpenChange={setIsConfirmOpen}
          onConfirm={handleApply}
          isPending={isApplying}
          error={errorMessage}
          variant="destructive"
          title="Convert this drama to a movie?"
          description="The drama, its season, and its episode move to Trash. A new standalone movie is created with the same content."
          affectedContent={
            <div className="space-y-1">
              <p className="font-medium">{dramaTitle}</p>
              <p>Source episode: {episodeTitle ?? plan.source.episodeTitle}</p>
              <p>Resulting movie: {plan.movie.title}</p>
            </div>
          }
          consequences={
            <ul className="list-disc space-y-1 pl-4">
              <li>The movie keeps the drama's title, slug, description, images, and video source.</li>
              <li>Ratings, reviews, bookmarks, viewing records, and notifications move to the movie.</li>
              <li>The original drama row is retained in Trash with permanent provenance.</li>
            </ul>
          }
          confirmLabel="Convert to movie"
          pendingLabel="Converting…"
        />
       : null}
    </div>
  );
}
