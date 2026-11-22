import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DramaEditForm } from '@/components/admin/dramas/drama-edit-form';
import { DRAMA_FORM_DEFAULTS } from '@/lib/contracts/drama-form';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { getDramaForAdmin, listDramaTaxonomy } from '@/workflows/admin/dramas';

import { requireAdminPageAccess } from '../../../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/dramas/[id]/edit';

export default async function AdminEditDramaPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  if (!hasPermission(actor, toPermissionKey('drama', 'manage'))) {
    notFound();
  }

  const { id } = await params;
  const [detail, taxonomy] = await Promise.all([
    getDramaForAdmin(actor, id),
    listDramaTaxonomy(actor),
  ]);

  if (!detail) {
    notFound();
  }

  const { drama } = detail;

  const defaultValues: Record<string, unknown> = {
    ...DRAMA_FORM_DEFAULTS,
    title: drama.title,
    description: drama.description ?? '',
    status: drama.status === 'completed' ? 'completed' : 'ongoing',
    structure_type: drama.structure_type,
    visibility: drama.visibility === 'hidden' ? 'hidden' : 'coming_soon',
    poster: drama.poster ?? '',
    banner: drama.banner ?? '',
    categories: drama.categoryIds,
    platforms: drama.platformIds,
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link
          href={`/admin/dramas/${drama.id}`}
          className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          ← Back to drama
        </Link>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Edit drama</h1>
        <p className="text-sm text-muted-foreground">
          Update metadata, artwork, taxonomy, and empty-drama visibility. The slug stays derived
          from the title.
        </p>
      </div>

      <DramaEditForm
        dramaId={drama.id}
        defaultValues={defaultValues}
        categories={taxonomy.categories}
        platforms={taxonomy.platforms}
      />
    </div>
  );
}
