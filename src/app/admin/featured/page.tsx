import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { FeaturedContentPicker } from '@/components/admin/homepage/featured-content-picker';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { getFeaturedContentSetting } from '@/modules/administration';
import { listPublicHeroCandidates } from '@/modules/content';

import { requireAdminPageAccess } from '../_access';

/**
 * The homepage hero selection.
 *
 * The candidate list comes from the content module's public hero read model,
 * so only content the public can already open is offered. The automatic
 * fallback keeps working when nothing is selected, and when the selected item
 * later becomes unpublished or trashed.
 */

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/featured';

export default async function AdminFeaturedPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('settings', 'manage'))) {
    notFound();
  }

  const [selected, candidates] = await Promise.all([
    getFeaturedContentSetting(),
    listPublicHeroCandidates(24),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Homepage hero
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The drama or movie the homepage shows first. When nothing is selected, or the
          selected item is no longer published, the homepage picks a suitable published
          item instead.
        </p>
      </div>

      <FeaturedContentPicker
        candidates={candidates.map(candidate => ({
          type: candidate.type,
          id: candidate.id,
          title: candidate.title,
          poster: candidate.poster,
        }))}
        selected={selected}
      />
    </div>
  );
}
