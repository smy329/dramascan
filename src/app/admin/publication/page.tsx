import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { PublicationManager } from '@/components/admin/publication/publication-manager';
import { hasPermission } from '@/modules/authorization';
import type { TableQueryState } from '@/lib/contracts/table';
import { publicationContentTypeSchema } from '@/modules/content/validation';
import { listPublicationItems, parsePublicationListQuery } from '@/workflows/admin/publication';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/publication';

/** The permission each content type needs to appear in the workbench. */
const PERMISSION_BY_TYPE = {
  drama: 'drama.manage',
  season: 'season.manage',
  episode: 'episode.manage',
  movie: 'movie.manage',
} as const;

export default async function AdminPublicationPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  const raw = await searchParams;
  const parsedType = publicationContentTypeSchema.safeParse(
    typeof raw.type === 'string' ? raw.type : 'drama'
  );
  const contentType = parsedType.success ? parsedType.data : 'drama';

  if (!hasPermission(actor, PERMISSION_BY_TYPE[contentType])) {
    notFound();
  }

  const query = parsePublicationListQuery({
    page: raw.page,
    pageSize: raw.pageSize,
    search: typeof raw.q === 'string' ? raw.q : '',
  });

  const result = await listPublicationItems(actor, contentType, query);

  const state: TableQueryState = {
    page: result.page,
    pageSize: result.pageSize,
    sort: '',
    search: query.search,
    filters: { type: contentType },
  };

  return (
    <PublicationManager
      contentType={contentType}
      items={result.items}
      page={result.page}
      pageSize={result.pageSize}
      total={result.total}
      totalPages={result.totalPages}
      state={state}
    />
  );
}
