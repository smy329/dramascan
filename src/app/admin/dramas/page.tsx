import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import type { ConversionStructureType } from '@/modules/content/validation';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import {
  formatConversionSortToken,
  listConversionCandidates,
  parseConversionListQuery,
  type ConversionListItem,
} from '@/workflows/admin/conversion';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/dramas';

const STRUCTURE_LABELS: Record<ConversionStructureType, string> = {
  flat: 'Flat',
  season_based: 'Season-based',
};

function formatStructure(row: ConversionListItem): string {
  return STRUCTURE_LABELS[row.structureType] ?? row.structureType;
}

function formatDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export default async function AdminDramasPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('drama', 'manage'))) {
    notFound();
  }

  const raw = await searchParams;
  const query = parseConversionListQuery(raw);
  const result = await listConversionCandidates(actor, query);

  const state: TableQueryState = {
    page: result.page,
    pageSize: query.pageSize,
    sort: formatConversionSortToken(query.sortBy, query.sortDirection),
    search: query.search,
    filters: {},
  };

  const columns: readonly AdminTableColumn<ConversionListItem>[] = [
    {
      key: 'title',
      header: 'Title',
      sortKey: 'title',
      render: row => row.title,
    },
    {
      key: 'structure',
      header: 'Structure',
      render: formatStructure,
    },
    {
      key: 'episodes',
      header: 'Active episodes',
      visibility: 'sm',
      align: 'right',
      render: row => String(row.activeEpisodes),
    },
    {
      key: 'created',
      header: 'Created',
      sortKey: 'createdAt',
      visibility: 'lg',
      render: row => formatDate(row.createdAt),
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: row =>
        <Link
          href={`/admin/dramas/${row.id}/convert`}
          className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Convert structure
        </Link>
      ,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Dramas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Convert a drama between a season-based and a flat episode structure.
        </p>
      </div>

      <AdminTableToolbar
        pathname={PATHNAME}
        state={state}
        searchLabel="Search dramas"
        searchPlaceholder="Drama title"
        clearHref={buildTableHref(PATHNAME, state, { page: 1, search: '', filters: {} })}
      />

      <AdminDataTable
        caption="Dramas"
        columns={columns}
        rows={result.items}
        rowKey={row => row.id}
        pathname={PATHNAME}
        state={state}
        empty={<p className="text-sm text-muted-foreground">No dramas exist yet.</p>}
      />

      <AdminTablePagination
        pathname={PATHNAME}
        state={state}
        total={result.total}
        totalPages={result.totalPages}
        itemLabel="dramas"
      />
    </div>
  );
}
