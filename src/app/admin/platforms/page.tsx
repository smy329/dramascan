import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { TaxonomyManager } from '@/components/admin/taxonomy/taxonomy-manager';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listPlatforms } from '@/workflows/admin/taxonomy';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/platforms';

export default async function AdminPlatformsPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('platform', 'manage'))) {
    notFound();
  }

  const { platforms } = await listPlatforms(actor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Platforms</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Streaming services and distributors. The URL slug is generated from the
          name and is never typed by an administrator.
        </p>
      </div>

      <TaxonomyManager resource="platform" rows={platforms} />
    </div>
  );
}
