import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { DramaConversionPanel } from '@/components/admin/dramas/drama-conversion-panel';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';
import { loadConversionContext } from '@/workflows/admin/conversion';

import { requireAdminPageAccess } from '../../../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/dramas';

export default async function AdminDramaConvertPage({
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
    context = await loadConversionContext(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }

    throw error;
  }

  return (
    <DramaConversionPanel
      dramaId={context.drama.id}
      dramaTitle={context.drama.title}
      currentStructureType={context.drama.structureType}
      episodes={context.episodes.map(episode => ({
        id: episode.id,
        title: episode.title,
        episodeNumber: episode.episodeNumber,
        position: episode.position,
        seasonId: episode.seasonId,
      }))}
      hasAvailableSnapshot={context.availableSnapshot !== null}
    />
  );
}
