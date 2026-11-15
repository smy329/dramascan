import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { DramaMovieConversionPanel } from '@/components/admin/dramas/drama-movie-conversion-panel';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';
import { loadMovieConversionContext } from '@/workflows/admin/movie-conversion';

import { requireAdminPageAccess } from '../../../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/dramas';

export default async function AdminDramaConvertToMoviePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('drama', 'manage'))) {
    notFound();
  }

  const { id } = await params;

  let context;

  try {
    context = await loadMovieConversionContext(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }

    throw error;
  }

  const episode = context.activeEpisodes[0] ?? null;

  return (
    <DramaMovieConversionPanel
      dramaId={context.drama.id}
      dramaTitle={context.drama.title}
      eligible={context.eligible}
      ineligibilityReason={context.ineligibilityReason}
      episodeTitle={episode?.title ?? null}
      activeEpisodeCount={context.activeEpisodes.length}
    />
  );
}
