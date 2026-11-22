import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { MovieRowActions } from '@/components/admin/movies/movie-row-actions';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import { listMovies, parseListMoviesQuery } from '@/workflows/admin/movies';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/movies';

function formatDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export default async function AdminMoviesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  if (!hasPermission(actor, toPermissionKey('movie', 'manage'))) {
    notFound();
  }

  const raw = await searchParams;
  const query = parseListMoviesQuery({
    page: raw.page,
    pageSize: raw.pageSize,
    q: raw.q,
    status: typeof raw.status === 'string' ? raw.status : undefined,
  });
  const result = await listMovies(actor, query);

  const state: TableQueryState = {
    page: result.page,
    pageSize: query.pageSize,
    sort: '',
    search: query.search,
    filters: {},
  };

  const columns: readonly AdminTableColumn<(typeof result.movies)[number]>[] = [
    {
      key: 'title',
      header: 'Title',
      render: row => (
        <Link
          href={`/admin/movies/${row.id}/edit`}
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          {row.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Publication',
      render: row => row.publicationStatus ?? 'draft',
    },
    {
      key: 'source',
      header: 'Video source',
      visibility: 'sm',
      render: row => (row.videoSource ? 'Set' : 'Missing'),
    },
    {
      key: 'updated',
      header: 'Updated',
      visibility: 'lg',
      render: row => formatDate(row.updatedAt),
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: row => <MovieRowActions movieId={row.id} title={row.title} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Movies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Standalone movies with their own metadata, artwork, and direct HTTPS MP4 source.
          </p>
        </div>
        <Link
          href="/admin/movies/new"
          className="inline-flex h-8 shrink-0 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Add movie
        </Link>
      </div>

      <AdminTableToolbar
        pathname={PATHNAME}
        state={state}
        searchLabel="Search movies"
        searchPlaceholder="Movie title"
        clearHref={buildTableHref(PATHNAME, state, { page: 1, search: '', filters: {} })}
      />

      <AdminDataTable
        caption="Movies"
        columns={columns}
        rows={result.movies}
        rowKey={row => row.id}
        pathname={PATHNAME}
        state={state}
        empty={<p className="text-sm text-muted-foreground">No movies exist yet.</p>}
      />

      <AdminTablePagination
        pathname={PATHNAME}
        state={state}
        total={result.total}
        totalPages={result.totalPages}
        itemLabel="movies"
      />
    </div>
  );
}
