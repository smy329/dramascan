import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import { useEffect, useState } from 'react';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/dramas/[id]/similar-dramas';

export default async function AdminSimilarDramasPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  const [dramaId, setDramaId] = useState<string>('');
  const [dramaTitle, setDramaTitle] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const id = params.get('dramaId');
    if (id) {
      setDramaId(id);
      // Fetch drama title
      fetch(`/admin/api/dramas/${id}`)
        .then(r => r.json())
        .then(d => setDramaTitle(d.title))
        .catch(() => setDramaTitle(''));
    }
  }, [searchParams]);

  if (!dramaId) {
    return (
      <div className='space-y-6'>
        <h1 className='font-heading text-2xl font-semibold text-foreground'>
          Similar Drama Management
        </h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          Select a drama to manage its similar dramas.
        </p>
        <p className='text-sm text-muted-foreground'>
          Navigate to a drama using: <code>/admin/dramas/{dramaId}/similar-dramas?dramaId={dramaId}</code>
        </p>
      </div>
    );
  }

  // Load similar dramas data
  const [similarDrams, setSimilarDrams] = useState<any[]>([]);
  const [query, setQuery] = useState<{ page: number; pageSize: number; sort: string; order: string; search: string }>({
    page: 1,
    pageSize: 20,
    sort: 'title',
    order: 'asc',
    search: '',
  });

  useEffect(() => {
    fetch(`/admin/api/similar-dramas?dramaId=${dramaId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (r) => {
        const data = await r.json();
        if (data.ok) {
          setSimilarDrams(data.data);
          setQuery({
            page: data.meta.page,
            pageSize: data.meta.pageSize,
            sort: data.meta.search ? 'title' : 'title',
            order: 'asc',
            search: data.meta.search || '',
          });
        }
      })
      .catch((e) => console.error(e));
  }, [dramaId]);

  const columns: readonly AdminTableColumn<any>[] = [
    {
      key: 'title',
      header: 'Title',
      sortKey: 'title',
      render: row => row.title,
    },
    {
      key: 'poster',
      header: 'Poster',
      render: row => row.poster ? <img src={row.poster} alt={row.title} className='h-6 w-auto' /> : '-',
    },
    {
      key: 'position',
      header: 'Position',
      sortKey: 'position',
      align: 'right',
      render: row => String(row.position),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: row => (
        <div className='flex flex-wrap justify-end gap-2'>
          <Link
            href={`/admin/dramas/${dramaId}/similar-dramas/edit`}
            className='text-xs text-medium text-foreground underline underline-offset-2 hover:text-primary'>
            Edit
          </Link>
          <button
            onClick={() => fetch('/admin/api/similar-dramas', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dramaId, similarDramaId: row.id }),
            })}
            className='text-xs text-destructive hover:text-destructive'
          >
            Remove
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='font-heading text-2xl font-semibold text-foreground'>
          Similar Dramas for {dramaTitle}
        </h1>
      </div>

      <AdminTableToolbar
        pathname={PATHNAME}
        searchLabel='Search similar dramas'
        searchPlaceholder='Search similar drama title'
      />

      <AdminDataTable
        caption='Similar Dramas'
        columns={columns}
        rows={similarDrams}
        rowKey={row => row.id}
        pathname={PATHNAME}
        state={{
          page: query.page,
          pageSize: query.pageSize,
          sort: query.sort,
          search: query.search,
          filters: {},
        }}
        empty={<p className='text-sm text-muted-foreground'>No similar dramas found.</p>}
      />

      <AdminTablePagination
        pathname={PATHNAME}
        state={{ page: query.page, pageSize: query.pageSize, total: similarDrams.length }}
        total={similarDrams.length}
        itemLabel='similar dramas'
      />
    </div>
  );
}