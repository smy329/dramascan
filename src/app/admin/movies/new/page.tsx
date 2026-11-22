import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MovieCreateForm } from '@/components/admin/movies/movie-form';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listMovieTaxonomy } from '@/workflows/admin/movies';

import { requireAdminPageAccess } from '../../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/movies/new';

export default async function AdminNewMoviePage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  if (!hasPermission(actor, toPermissionKey('movie', 'manage'))) {
    notFound();
  }

  const taxonomy = await listMovieTaxonomy(actor);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/admin/movies"
          className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          ← Back to movies
        </Link>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Add movie</h1>
        <p className="text-sm text-muted-foreground">
          Create a standalone movie. Upload artwork and verify that the direct MP4 source plays in
          the preview before saving.
        </p>
      </div>

      <MovieCreateForm categories={taxonomy.categories} platforms={taxonomy.platforms} />
    </div>
  );
}
