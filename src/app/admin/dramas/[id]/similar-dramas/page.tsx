import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { SimilarDramaManager } from '@/components/admin/dramas/similar-drama-manager';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';
import type { TableQueryState } from '@/lib/contracts/table';
import {
  formatSimilarDramaSortToken,
  loadSimilarDramasPage,
  parseSimilarDramaTableQuery,
} from '@/workflows/admin/similar-dramas';

import { requireAdminPageAccess } from '../../../_access';

export const dynamic = 'force-dynamic';

/** The route pattern used for the access gate and diagnostics. */
const PATHNAME = '/admin/dramas/[id]/similar-dramas';

/**
 * Server entrypoint for the similar-drama manager.
 *
 * The Server Component owns authorization, route-parameter resolution, and the
 * initial read. `params` is a Promise in the App Router, so it must be awaited;
 * the previous implementation read hooks here and never used the drama id.
 */
export default async function AdminSimilarDramasPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the drill-down requires its own key.
  if (!hasPermission(actor, toPermissionKey('similar_drama', 'manage'))) {
    notFound();
  }

  const { id } = await params;
  const query = parseSimilarDramaTableQuery(await searchParams);

  try {
    const { drama, result } = await loadSimilarDramasPage(actor, id, query);

    const state: TableQueryState = {
      page: result.page,
      pageSize: result.pageSize,
      sort: formatSimilarDramaSortToken(query.sort, query.order),
      search: query.search ?? '',
      filters: {},
    };

    return (
      <SimilarDramaManager
        drama={drama}
        initialItems={result.items}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        state={state}
      />
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }

    throw error;
  }
}
