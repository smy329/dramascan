import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { TrendingPinsEditor } from '@/components/admin/homepage/trending-pins-editor';
import { getTrendingPinsSetting } from '@/modules/administration';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listPublicHeroCandidates } from '@/modules/content';

import { requireAdminPageAccess } from '../_access';

/**
 * The administrator's Trending pins.
 *
 * A pinned item is placed at the head of the Trending ranking. The pins never
 * change the underlying activity score: they only decide which eligible item
 * is shown first.
 */

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/trending-pins';

export default async function AdminTrendingPinsPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('settings', 'manage'))) {
    notFound();
  }

  const [pins, candidates] = await Promise.all([
    getTrendingPinsSetting(),
    listPublicHeroCandidates(24),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Trending pins
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pin a published title to the head of the Trending ranking. The ranking score is
          unchanged; the pin only decides what is shown first.
        </p>
      </div>

      <TrendingPinsEditor
        items={pins}
        candidates={candidates.map(candidate => ({
          type: candidate.type,
          id: candidate.id,
          title: candidate.title,
        }))}
      />
    </div>
  );
}
