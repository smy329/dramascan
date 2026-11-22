import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SeasonManager } from '@/components/admin/dramas/season-manager';
import { EpisodeManager } from '@/components/admin/dramas/episode-manager';
import { DramaTrashButton } from '@/components/admin/dramas/drama-trash-button';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import type { SeasonDto } from '@/lib/contracts/season-form';
import type { EpisodeDto } from '@/lib/contracts/episode-form';
import { getDramaForAdmin } from '@/workflows/admin/dramas';
import { listSeasons } from '@/workflows/admin/seasons';
import { listEpisodes } from '@/workflows/admin/episodes';

import { requireAdminPageAccess } from '../../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/dramas/[id]';

function formatDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export default async function AdminDramaDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('drama', 'manage'))) {
    notFound();
  }

  const { id } = await params;

  const detail = await getDramaForAdmin(actor, id);

  if (!detail) {
    notFound();
  }

  const { drama, categoryNames, platformNames } = detail;

  let seasons: SeasonDto[] = [];

  if (hasPermission(actor, toPermissionKey('season', 'manage'))) {
    const listed = await listSeasons(actor, id);

    seasons = listed.seasons.map(season => ({
      id: season.id,
      dramaId: season.dramaId,
      title: season.title,
      position: season.position,
      episodeCount: season.episodeCount,
      createdAt: season.createdAt,
    }));
  }

  let episodesData = [] as EpisodeDto[];

  const canManageEpisodes = hasPermission(actor, toPermissionKey('episode', 'manage'));

  if (canManageEpisodes) {
    const listed = await listEpisodes(actor, id, { page: 1, pageSize: 100 });
    episodesData = listed.episodes;
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link
          href="/admin/dramas"
          className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Back to dramas
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{drama.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/admin/dramas/${drama.id}/edit`}
              className="inline-flex h-8 shrink-0 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
            >
              Edit drama
            </Link>
            <DramaTrashButton
              dramaId={drama.id}
              title={drama.title}
              affectedSeasons={drama.activeSeasons}
              affectedEpisodes={drama.activeEpisodes}
            />
          </div>
        </div>
      </header>

      <section aria-labelledby="drama-summary-heading" className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 id="drama-summary-heading" className="text-sm font-medium text-foreground">
          Summary
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Structure</dt>
            <dd className="text-foreground">{drama.structure_type}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="text-foreground">{drama.slug}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Categories</dt>
            <dd className="text-foreground">
              {categoryNames.length > 0 ? categoryNames.join(', ') : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Platforms</dt>
            <dd className="text-foreground">
              {platformNames.length > 0 ? platformNames.join(', ') : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Active seasons</dt>
            <dd className="text-foreground">{drama.activeSeasons}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Active episodes</dt>
            <dd className="text-foreground">{drama.activeEpisodes}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Created</dt>
            <dd className="text-foreground">{formatDate(drama.createdAt)}</dd>
          </div>
        </dl>
      </section>

      {hasPermission(actor, toPermissionKey('season', 'manage')) ? (
        <section aria-labelledby="drama-seasons-heading">
          <h2 id="drama-seasons-heading" className="sr-only">
            Seasons
          </h2>
          <SeasonManager
            dramaId={drama.id}
            structureType={drama.structure_type}
            seasons={seasons}
          />
        </section>
      ) : null}

      {canManageEpisodes ? (
        <section aria-labelledby="drama-episodes-heading">
          <h2 id="drama-episodes-heading" className="sr-only">
            Episodes
          </h2>
          <EpisodeManager
            dramaId={drama.id}
            structureType={drama.structure_type}
            seasons={seasons}
            episodes={episodesData}
          />
        </section>
      ) : null}
    </div>
  );
}
