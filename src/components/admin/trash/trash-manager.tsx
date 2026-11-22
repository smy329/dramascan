'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, Undo2 } from 'lucide-react';

import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
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
import type {
  PermanentDeleteImpact,
  TrashContentType,
  TrashItem,
} from '@/lib/contracts/trash';

/**
 * Trash administration surface.
 *
 * The server page owns authorization and the initial read. This island owns
 * only the interactions: restoring an item, previewing the consequences of a
 * permanent deletion, and confirming it. Every mutation refreshes the server
 * data instead of mutating the cached list in place, so the table never shows
 * a row that the database has already discarded.
 */

export type TrashManagerProps = Readonly<{
  items: TrashItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  retentionDays: number;
  state: TableQueryState;
  /** Only a Super Admin may permanently delete content. */
  canPermanentlyDelete: boolean;
}>;

type Impact = PermanentDeleteImpact;

const TYPE_LABELS: Record<TrashContentType, string> = {
  drama: 'Drama',
  season: 'Season',
  episode: 'Episode',
  movie: 'Movie',
};

const TYPE_TABS: readonly { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
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

function formatDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function renderImpact(impact: Impact | null): JSX.Element {
  if (!impact) {
    return <p className="text-sm text-muted-foreground">Loading the affected records…</p>;
  }

  const rows: readonly [string, number][] = [
    ['Seasons', impact.seasons],
    ['Episodes', impact.episodes],
    ['Bookmarks', impact.bookmarks],
    ['Playback progress', impact.playbackProgress],
    ['Watched state', impact.watchedState],
    ['Watch history', impact.watchHistory],
    ['Ratings (anonymized)', impact.ratings],
    ['Reviews (anonymized)', impact.reviews],
    ['Analytics events', impact.analyticsEvents],
    ['Notifications', impact.notifications],
    ['Metadata rows', impact.metadataRows],
  ];

  return (
    <ul className="space-y-1">
      {rows.map(([label, value]) => (
        <li key={label} className="flex justify-between gap-4">
          <span>{label}</span>
          <span className="tabular-nums">{value}</span>
        </li>
      ))}
    </ul>
  );
}

export function TrashManager({
  items,
  page,
  pageSize,
  total,
  totalPages,
  retentionDays,
  state,
  canPermanentlyDelete,
}: TrashManagerProps): JSX.Element {
  const router = useRouter();
  const pathname = '/admin/trash';

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<TrashItem | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<Impact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkImpact, setBulkImpact] = useState<Impact[] | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const type = state.filters.type ?? 'all';

  function clearFailure(): void {
    setError(null);
  }

  function itemKey(item: TrashItem): string {
    return `${item.contentType}:${item.id}`;
  }

  function toggleSelection(item: TrashItem): void {
    const key = itemKey(item);

    setSelected(current =>
      (current.includes(key) ? current.filter(value => value !== key) : [...current, key])
    );
  }

  async function restore(item: TrashItem): Promise<void> {
    setPending(itemKey(item));
    clearFailure();

    try {
      const response = await fetch('/admin/api/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: item.contentType, id: item.id }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to restore the item.');
    } finally {
      setPending(null);
    }
  }

  async function openDeleteDialog(item: TrashItem): Promise<void> {
    setDeleteTarget(item);
    setDeleteImpact(null);
    setDeleteError(null);

    try {
      const response = await fetch('/admin/api/trash/permanent-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: item.contentType, id: item.id, preview: true }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      const body = (await response.json()) as { data?: Impact };
      setDeleteImpact(body.data ?? null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Failed to load the impact.');
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) {
      return;
    }

    setPending(itemKey(deleteTarget));
    setDeleteError(null);

    try {
      const response = await fetch('/admin/api/trash/permanent-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: deleteTarget.contentType, id: deleteTarget.id }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      setDeleteTarget(null);
      setDeleteImpact(null);
      router.refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Failed to delete the item.');
    } finally {
      setPending(null);
    }
  }

  async function openBulkDialog(): Promise<void> {
    setBulkOpen(true);
    setBulkImpact(null);
    setBulkError(null);

    try {
      const impacts: Impact[] = [];

      for (const key of selected) {
        const [contentType, id] = key.split(':') as [TrashContentType, string];

        const response = await fetch('/admin/api/trash/permanent-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType, id, preview: true }),
        });

        if (!response.ok) {
          throw new Error(await readFailure(response));
        }

        const body = (await response.json()) as { data?: Impact };

        if (body.data) {
          impacts.push(body.data);
        }
      }

      setBulkImpact(impacts);
    } catch (cause) {
      setBulkError(cause instanceof Error ? cause.message : 'Failed to load the impact.');
    }
  }

  async function confirmBulkDelete(): Promise<void> {
    setPending('bulk');
    setBulkError(null);

    try {
      const items = selected.map(key => {
        const [contentType, id] = key.split(':') as [TrashContentType, string];
        return { contentType, id };
      });

      const response = await fetch('/admin/api/trash/permanent-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      const body = (await response.json()) as {
        data?: { failed: number; results: { id: string; message: string | null }[] };
      };

      if ((body.data?.failed ?? 0) > 0) {
        const failures = body.data?.results.filter(result => result.message !== null) ?? [];
        setBulkError(
          failures.map(failure => failure.message).filter(Boolean).join(' ') ||
            'Some items could not be deleted.'
        );
      }

      setSelected([]);
      setBulkOpen(false);
      setBulkImpact(null);
      router.refresh();
    } catch (cause) {
      setBulkError(cause instanceof Error ? cause.message : 'Failed to delete the items.');
    } finally {
      setPending(null);
    }
  }

  const selectedItems = items.filter(item => selected.includes(itemKey(item)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Trash</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Content is removed permanently {retentionDays} days after it was moved here. Restoring a
            drama also restores the seasons and episodes that were trashed with it.
          </p>
        </div>
        {canPermanentlyDelete ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void openBulkDialog()}
            disabled={selected.length === 0 || pending !== null}
          >
            <Trash2 aria-hidden="true" />
            Delete selected permanently
          </Button>
        ) : null}
      </div>

      <nav aria-label="Trash content type" className="flex flex-wrap gap-2">
        {TYPE_TABS.map(tab => {
          const isActive = tab.value === type;

          return (
            <Link
              key={tab.value}
              href={buildTableHref(pathname, state, {
                page: 1,
                filters: { type: tab.value === 'all' ? '' : tab.value },
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
        searchLabel="Search Trash"
        searchPlaceholder="Title"
        clearHref={buildTableHref(pathname, state, { page: 1, search: '', filters: state.filters })}
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">The Trash is empty.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {canPermanentlyDelete ? (
                  <TableHead className="w-10">
                    <span className="sr-only">Select</span>
                  </TableHead>
                ) : null}
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Parent</TableHead>
                <TableHead>Trashed</TableHead>
                <TableHead className="hidden lg:table-cell">Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => {
                const key = itemKey(item);
                const childCount = item.childCounts.seasons + item.childCounts.episodes;

                return (
                  <TableRow key={key}>
                    {canPermanentlyDelete ? (
                      <TableCell>
                        <Input
                          type="checkbox"
                          aria-label={`Select ${item.title}`}
                          checked={selected.includes(key)}
                          onChange={() => toggleSelection(item)}
                          disabled={pending !== null}
                          className="size-4"
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium text-foreground">{item.title}</TableCell>
                    <TableCell>{TYPE_LABELS[item.contentType]}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {item.parentTitle ?? '—'}
                    </TableCell>
                    <TableCell>
                      {formatDate(item.deletedAt)}
                      {childCount > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          {childCount} child record{childCount === 1 ? '' : 's'} affected
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{formatDate(item.expiresAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void restore(item)}
                          disabled={pending !== null}
                          aria-busy={pending === key ? true : undefined}
                        >
                          <Undo2 aria-hidden="true" />
                          Restore
                        </Button>
                        {canPermanentlyDelete ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => void openDeleteDialog(item)}
                            disabled={pending !== null}
                          >
                            Delete permanently
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminTablePagination
        pathname={pathname}
        state={state}
        total={total}
        totalPages={totalPages}
        itemLabel="trashed items"
      />

      <p className="text-xs text-muted-foreground">
        Page {page} of {Math.max(totalPages, 1)} · {pageSize} per page
      </p>

      <ConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteImpact(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
        isPending={pending !== null}
        error={deleteError}
        title="Permanently delete this content?"
        description={
          deleteTarget
            ? `"${deleteTarget.title}" will be removed for good. This cannot be undone.`
            : undefined
        }
        affectedContent={renderImpact(deleteImpact)}
        affectedContentLabel="Affected records"
        consequences={
          <p>
            Bookmarks, playback progress, watched state, and watch history are removed. Ratings and
            reviews are kept for aggregate analytics, but the author identity is removed.
          </p>
        }
        confirmLabel="Delete permanently"
        pendingLabel="Deleting…"
        variant="destructive"
      />

      <ConfirmationDialog
        open={bulkOpen}
        onOpenChange={open => {
          if (!open) {
            setBulkOpen(false);
            setBulkImpact(null);
            setBulkError(null);
          }
        }}
        onConfirm={() => void confirmBulkDelete()}
        isPending={pending === 'bulk'}
        error={bulkError}
        title="Permanently delete the selected content?"
        description={`${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} will be removed for good. This cannot be undone.`}
        affectedContent={
          bulkImpact === null ? (
            <p className="text-sm text-muted-foreground">Loading the affected records…</p>
          ) : (
            <ul className="space-y-1">
              {bulkImpact.map(impact => (
                <li key={`${impact.contentType}:${impact.id}`} className="flex justify-between gap-4">
                  <span>{impact.title}</span>
                  <span className="tabular-nums">
                    {impact.episodes} episode{impact.episodes === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
        affectedContentLabel="Affected records"
        consequences={
          <p>
            Bookmarks, playback progress, watched state, and watch history are removed. Ratings and
            reviews are kept for aggregate analytics, but the author identity is removed.
          </p>
        }
        confirmLabel="Delete permanently"
        pendingLabel="Deleting…"
        variant="destructive"
      />
    </div>
  );
}
