import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { TaxonomyManager } from '@/components/admin/taxonomy/taxonomy-manager';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listCategories } from '@/workflows/admin/taxonomy';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/categories';

export default async function AdminCategoriesPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('category', 'manage'))) {
    notFound();
  }

  const { categories } = await listCategories(actor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Categories</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Group dramas and movies. The URL slug is generated from the name and is
          never typed by an administrator.
        </p>
      </div>

      <TaxonomyManager resource="category" rows={categories} />
    </div>
  );
}
