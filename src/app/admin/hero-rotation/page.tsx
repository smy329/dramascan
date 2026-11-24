import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { HeroRotationEditor } from '@/components/admin/homepage/hero-rotation-editor';
import { getHeroRotationSetting } from '@/modules/administration';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listPublicHeroCandidates } from '@/modules/content';

import { requireAdminPageAccess } from '../_access';

/**
 * The homepage hero rotation.
 *
 * The rotation is optional. When it is off, the selected hero stays stable.
 * When it is on, it moves only among items that are still published — the
 * candidate list is the same public list the hero itself uses.
 */

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/hero-rotation';

export default async function AdminHeroRotationPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('settings', 'manage'))) {
    notFound();
  }

  const [rotation, candidates] = await Promise.all([
    getHeroRotationSetting(),
    listPublicHeroCandidates(24),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Hero rotation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rotate the homepage hero among a set of eligible published titles. The featured
          item is always the first slide. No scheduling engine is involved: the rotation
          runs in the browser.
        </p>
      </div>

      <HeroRotationEditor
        enabled={rotation.enabled}
        items={rotation.items}
        candidates={candidates.map(candidate => ({
          type: candidate.type,
          id: candidate.id,
          title: candidate.title,
        }))}
      />
    </div>
  );
}
