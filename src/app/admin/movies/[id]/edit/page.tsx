import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MovieEditForm } from '@/components/admin/movies/movie-form';
import { MOVIE_FORM_DEFAULTS } from '@/lib/contracts/movie-form';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { getMovieForAdmin, listMovieTaxonomy } from '@/workflows/admin/movies';

import { requireAdminPageAccess } from '../../../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/movies/[id]/edit';

export default async function AdminEditMoviePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  if (!hasPermission(actor, toPermissionKey('movie', 'manage'))) {
    notFound();
  }

  const { id } = await params;
  const [detail, taxonomy] = await Promise.all([getMovieForAdmin(actor, id), listMovieTaxonomy(actor)]);

  if (!detail) {
    notFound();
  }

  const { movie } = detail;

  const defaultValues: Record<string, unknown> = {
    ...MOVIE_FORM_DEFAULTS,
    title: movie.title,
    description: movie.description ?? '',
    poster: movie.poster ?? '',
    banner: movie.banner ?? '',
    video_source: movie.videoSource ?? '',
    categories: detail.categoryIds,
    platforms: detail.platformIds,
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/admin/movies"
          className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          ← Back to movies
        </Link>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Edit movie</h1>
        <p className="text-sm text-muted-foreground">
          Update metadata, artwork, taxonomy, and the direct video source.
        </p>
      </div>

      <MovieEditForm
        movieId={movie.id}
        defaultValues={defaultValues}
        categories={taxonomy.categories}
        platforms={taxonomy.platforms}
      />
    </div>
  );
}
