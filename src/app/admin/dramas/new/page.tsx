import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DramaCreateForm } from '@/components/admin/dramas/drama-create-form';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listDramaTaxonomy } from '@/workflows/admin/dramas';

import { requireAdminPageAccess } from '../../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/dramas/new';

/**
 * Admin drama creation page.
 *
 * The page gates access before reading anything, loads the active taxonomy for
 * the checkbox groups, and hands both to the client form. The Server Action and
 * the `createDrama` workflow re-check `drama.manage`, so the page guard is not
 * the only boundary.
 */
export default async function AdminNewDramaPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  if (!hasPermission(actor, toPermissionKey('drama', 'manage'))) {
    notFound();
  }

  const taxonomy = await listDramaTaxonomy(actor);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/admin/dramas"
          className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          ← Back to dramas
        </Link>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Add drama</h1>
        <p className="text-sm text-muted-foreground">
          Create the drama and choose its episode structure. Seasons and episodes are added
          afterwards.
        </p>
      </div>

      <DramaCreateForm categories={taxonomy.categories} platforms={taxonomy.platforms} />
    </div>
  );
}
