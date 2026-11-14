'use client';

import { useId, useMemo, useState, type JSX } from 'react';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { ConsequenceList } from '@/components/dialogs/consequence-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  ConversionPlanDto,
  ConversionRequestDto,
  ConversionStrategyDto,
  ConversionStructureTypeDto,
} from '@/lib/contracts/drama-conversion';

import {
  applyDramaConversion,
  previewDramaConversion,
} from '@/workflows/admin/conversion-actions';

/** One episode row shown in the distribution editor and the plan table. */
export type ConversionEpisodeRow = {
  id: string;
  title: string;
  episodeNumber: number | null;
  position: number | null;
  seasonId: string | null;
};

export type DramaConversionPanelProps = Readonly<{
  dramaId: string;
  dramaTitle: string;
  currentStructureType: ConversionStructureTypeDto;
  episodes: readonly ConversionEpisodeRow[];
  /** `true` when an available snapshot can still be restored. */
  hasAvailableSnapshot: boolean;
}>;

type SeasonDraft = {
  key: string;
  title: string;
  position: number;
};

type DraftAssignment = { episodeId: string; seasonKey: string };

function defaultSeasons(): SeasonDraft[] {
  return [{ key: 'season-1', title: 'Season 1', position: 0 }];
}

function defaultAssignments(
  episodes: readonly ConversionEpisodeRow[],
  seasons: readonly SeasonDraft[]
): DraftAssignment[] {
  const firstKey = seasons[0]?.key;

  if (firstKey === undefined) {
    return [];
  }

  return episodes.map(episode => ({ episodeId: episode.id, seasonKey: firstKey }));
}

function nextSeasonKey(seasons: readonly SeasonDraft[]): string {
  let index = seasons.length + 1;

  while (seasons.some(season => season.key === `season-${index}`)) {
    index += 1;
  }

  return `season-${index}`;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * Interactive structure conversion panel.
 *
 * The panel never decides whether a conversion is allowed: it collects the
 * administrator's intent, asks the server for a preview, and applies the
 * exact previewed plan through the Server Action. The fingerprint returned by
 * the preview is echoed back on apply, so a structure change between preview
 * and confirmation is rejected server-side instead of silently applied.
 */
export function DramaConversionPanel({
  dramaId,
  dramaTitle,
  currentStructureType,
  episodes,
  hasAvailableSnapshot,
}: DramaConversionPanelProps): JSX.Element {
  const targetStructureType: ConversionStructureTypeDto =
    currentStructureType === 'season_based' ? 'flat' : 'season_based';

  const [strategy, setStrategy] = useState<ConversionStrategyDto>(
    hasAvailableSnapshot ? 'restore_snapshot' : 'convert'
  );
  const [seasons, setSeasons] = useState<SeasonDraft[]>(defaultSeasons);
  const [assignments, setAssignments] = useState<DraftAssignment[]>(() =>
    defaultAssignments(episodes, defaultSeasons())
  );
  const [plan, setPlan] = useState<ConversionPlanDto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [appliedFingerprint, setAppliedFingerprint] = useState<string | null>(null);

  const descriptionId = useId();
  const planId = useId();

  const isFlatTarget = targetStructureType === 'flat';
  const needsDistribution = !isFlatTarget && strategy === 'convert';

  function buildRequest(mode: 'preview' | 'apply'): ConversionRequestDto {
    const request: ConversionRequestDto = {
      mode,
      targetStructureType,
    };

    if (!isFlatTarget) {
      request.strategy = strategy;

      if (strategy === 'convert') {
        request.distribution = {
          seasons: seasons.map(season => ({
            key: season.key,
            title: season.title,
            position: season.position,
          })),
          assignments: assignments.map(assignment => ({
            episodeId: assignment.episodeId,
            seasonKey: assignment.seasonKey,
          })),
        };
      }
    }

    if (mode === 'apply' && plan) {
      request.fingerprint = plan.fingerprint;
    }

    return request;
  }

  async function handlePreview(): Promise<void> {
    setIsPreviewing(true);
    setErrorMessage(null);
    setAppliedFingerprint(null);

    const result = await previewDramaConversion(dramaId, buildRequest('preview'));

    setIsPreviewing(false);

    if (!result.ok) {
      setPlan(null);
      setErrorMessage(result.error.message);
      return;
    }

    setPlan(result.data);
  }

  async function handleApply(): Promise<void> {
    if (!plan) {
      return;
    }

    setIsApplying(true);
    setErrorMessage(null);

    const result = await applyDramaConversion(dramaId, buildRequest('apply'));

    setIsApplying(false);

    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }

    setIsConfirmOpen(false);
    setPlan(result.data.plan);
    setAppliedFingerprint(result.data.newFingerprint);
  }

  function handleAddSeason(): void {
    const key = nextSeasonKey(seasons);

    setSeasons(current => [
      ...current,
      { key, title: `Season ${current.length + 1}`, position: current.length },
    ]);
    setPlan(null);
  }

  function handleRemoveSeason(key: string): void {
    const remaining = seasons.filter(season => season.key !== key);

    setSeasons(remaining);
    setAssignments(current =>
      current.map(assignment => {
        if (assignment.seasonKey === key) {
          return { ...assignment, seasonKey: remaining[0]?.key ?? '' };
        }

        return assignment;
      })
    );
    setPlan(null);
  }

  function handleSeasonTitleChange(key: string, title: string): void {
    setSeasons(current =>
      current.map(season => {
        if (season.key === key) {
          return { ...season, title };
        }

        return season;
      })
    );
    setPlan(null);
  }

  function handleSeasonPositionChange(key: string, position: number): void {
    setSeasons(current =>
      current.map(season => {
        if (season.key === key) {
          return { ...season, position };
        }

        return season;
      })
    );
    setPlan(null);
  }

  function handleAssignmentChange(episodeId: string, seasonKey: string): void {
    setAssignments(current =>
      current.map(assignment => {
        if (assignment.episodeId === episodeId) {
          return { ...assignment, seasonKey };
        }

        return assignment;
      })
    );
    setPlan(null);
  }

  function handleStrategyChange(nextStrategy: ConversionStrategyDto): void {
    setStrategy(nextStrategy);
    setPlan(null);
    setErrorMessage(null);
  }

  const consequenceItems = useMemo(() => {
    if (!plan) {
      return [];
    }

    const items: string[] = [];

    items.push(
      `${plan.counts.activeEpisodes} active episode(s) move to a ${
        plan.targetStructureType === 'flat' ? 'flat' : 'season-based'
      } structure.`
    );

    if (plan.targetStructureType === 'flat') {
      items.push('Active seasons are moved to Trash and can be restored from the snapshot.');
      items.push('Episode numbers are renumbered sequentially from 1.');
    } else if (plan.strategy === 'restore_snapshot') {
      items.push('The previous season structure is restored exactly.');
    } else {
      items.push(`${plan.counts.seasonsCreated} season(s) are created.`);
    }

    items.push('Episode IDs, viewing records, and episode metadata are preserved.');

    return items;
  }, [plan]);

  return (
    <div className="space-y-6" data-slot="drama-conversion-panel">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Convert “{dramaTitle}”
        </h1>
        <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
          Current structure: {currentStructureType === 'season_based' ? 'Season-based' : 'Flat'}.
          Converting changes it to {isFlatTarget ? 'flat' : 'season-based'}.
        </p>
      </div>

      {!isFlatTarget && hasAvailableSnapshot ?
        <fieldset className="rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Strategy</legend>
          <div className="mt-2 space-y-2">
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="conversion-strategy"
                value="restore_snapshot"
                checked={strategy === 'restore_snapshot'}
                onChange={() => handleStrategyChange('restore_snapshot')}
                className="mt-0.5"
              />
              <span>
                Restore previous structure
                <span className="block text-xs text-muted-foreground">
                  Re-applies the stored snapshot exactly. Blocked if the structure changed.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="conversion-strategy"
                value="convert"
                checked={strategy === 'convert'}
                onChange={() => handleStrategyChange('convert')}
                className="mt-0.5"
              />
              <span>
                Create new seasons
                <span className="block text-xs text-muted-foreground">
                  Replaces the stored snapshot with a new distribution.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
       : null}

      {needsDistribution ?
        <section className="rounded-xl border border-border p-4" aria-labelledby={`${planId}-dist`}>
          <h2 id={`${planId}-dist`} className="text-sm font-medium text-foreground">
            Season distribution
          </h2>

          <ul className="mt-3 space-y-3">
            {seasons.map(season =>
              <li key={season.key} className="grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
                <div className="space-y-1">
                  <label
                    htmlFor={`season-title-${season.key}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Season title
                  </label>
                  <Input
                    id={`season-title-${season.key}`}
                    value={season.title}
                    onChange={event => handleSeasonTitleChange(season.key, event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor={`season-position-${season.key}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Position
                  </label>
                  <Input
                    id={`season-position-${season.key}`}
                    type="number"
                    min={0}
                    value={season.position}
                    onChange={event =>
                      handleSeasonPositionChange(season.key, Number(event.target.value))
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleRemoveSeason(season.key)}
                  disabled={seasons.length <= 1}
                >
                  Remove
                </Button>
              </li>
            )}
          </ul>

          <Button type="button" variant="outline" className="mt-3" onClick={handleAddSeason}>
            Add season
          </Button>

          <div className="mt-6">
            <h3 className="text-sm font-medium text-foreground">Episode assignments</h3>
            <ul className="mt-2 space-y-2">
              {episodes.map(episode => {
                const assignment = assignments.find(row => row.episodeId === episode.id);

                return (
                  <li key={episode.id} className="grid gap-2 sm:grid-cols-[1fr_12rem] sm:items-center">
                    <label htmlFor={`assignment-${episode.id}`} className="text-sm text-foreground">
                      {episode.title}{' '}
                      <span className="text-xs text-muted-foreground">
                        (episode {formatNumber(episode.episodeNumber)})
                      </span>
                    </label>
                    <select
                      id={`assignment-${episode.id}`}
                      value={assignment?.seasonKey ?? ''}
                      onChange={event => handleAssignmentChange(episode.id, event.target.value)}
                      className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
                    >
                      {seasons.map(season =>
                        <option key={season.key} value={season.key}>
                          {season.title}
                        </option>
                      )}
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
       : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handlePreview} disabled={isPreviewing || isApplying}>
          {isPreviewing ? 'Building preview…' : 'Preview conversion'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsConfirmOpen(true)}
          disabled={!plan || isPreviewing || isApplying}
        >
          Confirm conversion
        </Button>
      </div>

      {errorMessage ?
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-foreground">{errorMessage}</p>
        </div>
       : null}

      <section aria-live="polite" aria-labelledby={planId}>
        <h2 id={planId} className="text-sm font-medium text-foreground">
          Preview
        </h2>

        {plan ?
          <div className="mt-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              {plan.counts.activeEpisodes} active episode(s),{' '}
              {plan.counts.seasonsCreated} season(s) created,{' '}
              {plan.counts.seasonsAffected} season(s) affected.
            </p>

            {plan.warnings.length > 0 ?
              <ConsequenceList items={plan.warnings} label="Warnings" />
             : null}

            {plan.snapshot ?
              <p className="text-sm text-muted-foreground">
                Snapshot {plan.snapshot.status}
                {plan.snapshot.restorable ? ' (restorable)' : ' (no longer restorable)'}.
              </p>
             : null}

            <table className="w-full text-left text-sm">
              <caption className="sr-only">Episode renumbering preview</caption>
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-1">
                    Episode
                  </th>
                  <th scope="col" className="py-1">
                    Current number
                  </th>
                  <th scope="col" className="py-1">
                    New number
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.episodes.map(episode =>
                  <tr key={episode.id} className="border-t border-border">
                    <td className="py-1 pr-3 text-foreground">{episode.title}</td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {formatNumber(episode.fromEpisodeNumber)}
                    </td>
                    <td className="py-1 text-foreground">
                      {formatNumber(episode.toEpisodeNumber)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
         :
          <p className="mt-2 text-sm text-muted-foreground">
            No preview yet. Build a preview before confirming a conversion.
          </p>
        }
      </section>

      {appliedFingerprint ?
        <p role="status" className="text-sm text-muted-foreground">
          Conversion applied.
        </p>
       : null}

      <ConfirmationDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        onConfirm={handleApply}
        isPending={isApplying}
        title="Confirm structure conversion"
        description={`This changes the structure of “${dramaTitle}”.`}
        affectedContent={
          <p>
            {plan?.counts.activeEpisodes ?? 0} active episode(s) will be renumbered and
            reassigned.
          </p>
        }
        consequences={<ConsequenceList items={consequenceItems} label="Consequences" />}
        confirmLabel="Convert"
        pendingLabel="Converting…"
      />
    </div>
  );
}
