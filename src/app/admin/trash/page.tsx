import type { JSX } from 'react';

import { TrashManager } from '@/components/admin/trash/trash-manager';
import { hasPermission } from '@/modules/authorization';
import type { TableQueryState } from '@/lib/contracts/table';
import { listTrashItems, parseTrashListQuery } from '@/workflows/admin/trash';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/trash';

/**
 * Server entrypoint for the Trash.
 *
 * The page owns authorization and the initial read. The type filter, search
 * term, and page live in the URL query string, so every view is linkable and
 * a reload reproduces it exactly.
 */
export default async function AdminTrashPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  const raw = await searchParams;
  const query = parseTrashListQuery({
    type: typeof raw.type === 'string' ? raw.type : 'all',
    page: raw.page,
    pageSize: raw.pageSize,
    search: typeof raw.q === 'string' ? raw.q : '',
  });

  const result = await listTrashItems(actor, query);

  const state: TableQueryState = {
    page: result.page,
    pageSize: result.pageSize,
    sort: '',
    search: query.search,
    filters: { type: query.type },
  };

  const canPermanentlyDelete =
    actor.isSuperAdmin &&
    hasPermission(actor, 'drama.manage') &&
    hasPermission(actor, 'season.manage') &&
    hasPermission(actor, 'episode.manage') &&
    hasPermission(actor, 'movie.manage');

  return (
    <TrashManager
      items={result.items}
      page={result.page}
      pageSize={result.pageSize}
      total={result.total}
      totalPages={result.totalPages}
      retentionDays={result.retentionDays}
      state={state}
      canPermanentlyDelete={canPermanentlyDelete}
    />
  );
}
