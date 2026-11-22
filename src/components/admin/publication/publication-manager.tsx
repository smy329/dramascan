'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';

import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import type { PublicationContentType } from '@/modules/content/validation';
import type { PublicationListItem } from '@/workflows/admin/publication';

/**
 * Publication workbench.
 *
 * The server page owns authorization and the initial read. This island owns
 * the selection and the two bulk operations. A bulk operation reports the
 * outcome per item: skipped items keep their reason, so the administrator
 * always learns why something was not published.
 */

export type PublicationManagerProps = Readonly<{
  contentType: PublicationContentType;
  items: PublicationListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  state: TableQueryState;
}>;

type PublicationItemResult = {
  id: string;
  status: 'succeeded' | 'skipped' | 'failed';
  reason: string | null;
  message?: string;
};

type PublicationSummary = {
  requested: number;
  succeeded: number;
  skipped: number;
  failed: number;
};

const TYPE_TABS: readonly { value: PublicationContentType; label: string }[] = [
  { value: 'drama', label: 'Dramas' },
  { value: 'season', label: 'Seasons' },
  { value: 'episode', label: 'Episodes' },
  { value: 'movie', label: 'Movies' },
];

function errorMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const candidate = body as {
      error?: { message?: unknown };
      message?: unknown;
    };

    if (typeof candidate.error?.message === 'string') return candidate.error.message;
    if (typeof candidate.message === 'string') return candidate.message;
  }

  return 'The request failed.';
}

async function readFailure(response: Response): Promise<string> {
  try {
    return errorMessage(await response.json());
  } catch {
    return 'The request failed.';
  }
}

function formatDate(value: string | null): string {
  return value === null ? '—' : new Date(value).toISOString().slice(0, 10);
}

export function PublicationManager({
  contentType,
  items,
  page,
  pageSize,
  total,
  totalPages,
  state,
}: PublicationManagerProps): JSX.Element {
  const router = useRouter();
  const pathname = '/admin/publication';

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<'publish' | 'unpublish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{
    summary: PublicationSummary;
    results: PublicationItemResult[];
  } | null>(null);

  function toggle(id: string): void {
    setSelected(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]));
  }

  async function run(action: 'publish' | 'unpublish'): Promise<void> {
    setPending(action);
    setError(null);
    setReport(null);

    try {
      const response = await fetch('/admin/api/publication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType, action, ids: selected }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      const body = (await response.json()) as {
        data?: { summary: PublicationSummary; results: PublicationItemResult[] };
      };

      if (body.data) {
        setReport({ summary: body.data.summary, results: body.data.results });
      }

      setSelected([]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The publication request failed.');
    } finally {
      setPending(null);
    }
  }

  const selectedItems = items.filter(item => selected.includes(item.id));
  const canPublish = selectedItems.some(item => item.eligibleToPublish);
  const canUnpublish = selectedItems.some(item => item.eligibleToUnpublish);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Publication</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Publishing a parent never publishes its children. Every item is published on its own, and
            an item that is not ready is skipped with the reason reported.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void run('publish')}
            disabled={!canPublish || pending !== null || selected.length === 0}
            aria-busy={pending === 'publish' ? true : undefined}
          >
            <Eye aria-hidden="true" />
            Publish selected
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void run('unpublish')}
            disabled={!canUnpublish || pending !== null || selected.length === 0}
            aria-busy={pending === 'unpublish' ? true : undefined}
          >
            <EyeOff aria-hidden="true" />
            Unpublish selected
          </Button>
        </div>
      </div>

      <nav aria-label="Content type" className="flex flex-wrap gap-2">
        {TYPE_TABS.map(tab => {
          const isActive = tab.value === contentType;

          return (
            <Link
              key={tab.value}
              href={buildTableHref(pathname, state, {
                page: 1,
                filters: { type: tab.value },
              })}
              aria-current={isActive ? 'page' : undefined}
              className={
                isActive
                  ? 'inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground'
                  : 'inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted'
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <AdminTableToolbar
        pathname={pathname}
        state={state}
        searchLabel="Search content"
        searchPlaceholder="Title"
        clearHref={buildTableHref(pathname, state, { page: 1, search: '', filters: state.filters })}
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {report ? (
        <section aria-labelledby="publication-report-heading" className="space-y-2 rounded-xl border border-border p-4">
          <h2 id="publication-report-heading" className="text-sm font-medium text-foreground">
            Last operation
          </h2>
          <p className="text-sm text-muted-foreground">
            {report.summary.succeeded} succeeded · {report.summary.skipped} skipped ·{' '}
            {report.summary.failed} failed
          </p>
          {report.results.some(result => result.status !== 'succeeded') ? (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {report.results
                .filter(result => result.status !== 'succeeded')
                .map(result => (
                  <li key={result.id}>
                    {result.id}: {result.message ?? result.reason ?? result.status}
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No content matches this view.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Select</span>
                </TableHead>
                <TableHead>Title</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="hidden lg:table-cell">First published</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Input
                      type="checkbox"
                      aria-label={`Select ${item.title}`}
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                      disabled={pending !== null}
                      className="size-4"
                    />
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{item.title}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      {item.publicationStatus === 'published' ? (
                        <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
                      ) : null}
                      {item.publicationStatus}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {item.hasVideoSource ? 'Set' : 'Not required'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(item.publishedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminTablePagination
        pathname={pathname}
        state={state}
        total={total}
        totalPages={totalPages}
        itemLabel="items"
      />

      <p className="text-xs text-muted-foreground">
        Page {page} of {Math.max(totalPages, 1)} · {pageSize} per page
      </p>
    </div>
  );
}
