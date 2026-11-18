'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import { AdminFormSelectField } from '@/components/admin/forms/admin-form-select-field';
import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/contracts/common';
import type { TableQueryState } from '@/lib/contracts/table';
import {
  CATEGORY_FORM_DEFAULTS,
  CATEGORY_VISIBILITY_OPTIONS,
  PLATFORM_FORM_DEFAULTS,
  categoryFormSchema,
  platformFormSchema,
  type TaxonomyDto,
} from '@/lib/contracts/taxonomy-form';
import {
  createCategoryAction,
  createPlatformAction,
  deleteCategoryAction,
  deletePlatformAction,
  reorderCategoriesAction,
  reorderPlatformsAction,
  updateCategoryAction,
  updatePlatformAction,
} from '@/workflows/admin/taxonomy-actions';

export type TaxonomyManagerProps = Readonly<{
  /** Which taxonomy resource this table manages. */
  resource: 'category' | 'platform';
  /** Active rows in display order, loaded by the server page. */
  rows: readonly TaxonomyDto[];
}>;

/**
 * Administrator surface for one taxonomy resource.
 *
 * The server page owns authorization and the initial read; this island owns
 * create, inline edit, reorder and soft delete. Every mutation refreshes the
 * server data instead of rewriting the cached list in place, so the position
 * and usage counts shown are the authoritative ones.
 */
export function TaxonomyManager({ resource, rows }: TaxonomyManagerProps): JSX.Element {
  const router = useRouter();
  const isCategory = resource === 'category';
  const label = isCategory ? 'category' : 'platform';
  const pathname = isCategory ? '/admin/categories' : '/admin/platforms';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TaxonomyDto | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const state: TableQueryState = {
    page: 1,
    pageSize: Math.max(rows.length, 1),
    sort: '',
    search: '',
    filters: {},
  };

  async function run(key: string, operation: () => Promise<ActionResult<unknown>>): Promise<void> {
    setPending(key);
    setFailure(null);

    try {
      const result = await operation();

      if (!result.ok) {
        setFailure(result.error.message);
        return;
      }

      router.refresh();
    } finally {
      setPending(null);
    }
  }

  function create(values: unknown): Promise<ActionResult<unknown>> {
    return isCategory ? createCategoryAction(values) : createPlatformAction(values);
  }

  function update(id: string, values: unknown): Promise<ActionResult<unknown>> {
    const payload = { id, ...(values as Record<string, unknown>) };

    return isCategory ? updateCategoryAction(payload) : updatePlatformAction(payload);
  }

  function remove(id: string): Promise<ActionResult<unknown>> {
    return isCategory ? deleteCategoryAction({ id }) : deletePlatformAction({ id });
  }

  function reorder(ordered: readonly TaxonomyDto[]): Promise<ActionResult<unknown>> {
    const ids = ordered.map(row => row.id);

    return isCategory ? reorderCategoriesAction({ ids }) : reorderPlatformsAction({ ids });
  }

  function move(index: number, direction: -1 | 1): void {
    const swap = index + direction;

    if (swap < 0 || swap >= rows.length) return;

    const ordered = [...rows];
    const moving = ordered[index]!;
    ordered[index] = ordered[swap]!;
    ordered[swap] = moving;

    void run(`move:${moving.id}`, () => reorder(ordered));
  }

  function confirmDelete(): void {
    const target = deleting;

    if (!target) return;

    setDeleting(null);
    void run(`delete:${target.id}`, () => remove(target.id));
  }

  function renderEditForm(row: TaxonomyDto): JSX.Element {
    const defaults = isCategory
      ? { name: row.name, visibility: row.visibility ?? 'visible' }
      : { name: row.name };

    return (
      <AdminForm
        schema={isCategory ? categoryFormSchema : platformFormSchema}
        serverAction={values => update(row.id, values)}
        defaultValues={defaults}
        resetOnSuccess={false}
        submitLabel="Save changes"
        onSuccess={() => {
          setEditingId(null);
          router.refresh();
        }}
      >
        <AdminFormField name="name" label="Name" required />
        {isCategory ? (
          <AdminFormSelectField
            name="visibility"
            label="Visibility"
            options={CATEGORY_VISIBILITY_OPTIONS}
            required
          />
        ) : null}
        <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
          Cancel
        </Button>
      </AdminForm>
    );
  }

  function renderActions(row: TaxonomyDto, index: number): JSX.Element {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => move(index, -1)}
          disabled={index === 0 || pending !== null}
          aria-label={`Move ${row.name} up`}
        >
          ↑
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => move(index, 1)}
          disabled={index === rows.length - 1 || pending !== null}
          aria-label={`Move ${row.name} down`}
        >
          ↓
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditingId(editingId === row.id ? null : row.id)}
          disabled={pending !== null}
        >
          {editingId === row.id ? 'Close' : 'Edit'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => setDeleting(row)}
          disabled={pending !== null}
        >
          Delete
        </Button>
      </div>
    );
  }

  function renderNameCell(row: TaxonomyDto): JSX.Element {
    return editingId === row.id ? renderEditForm(row) : (
      <span className="font-medium text-foreground">{row.name}</span>
    );
  }

  function renderVisibilityCell(row: TaxonomyDto): JSX.Element {
    return <span className="text-muted-foreground">{row.visibility ?? '—'}</span>;
  }

  const visibilityColumn: AdminTableColumn<TaxonomyDto> | null = isCategory
    ? {
        key: 'visibility',
        header: 'Visibility',
        render: renderVisibilityCell,
      }
    : null;

  const columns: AdminTableColumn<TaxonomyDto>[] = [
    {
      key: 'name',
      header: 'Name',
      render: renderNameCell,
    },
  ];

  if (visibilityColumn) {
    columns.push(visibilityColumn);
  }

  columns.push({
    key: 'actions',
    header: 'Actions',
    align: 'right',
    render: row => renderActions(row, rows.indexOf(row)),
  });

  return (
    <div className="space-y-6">
      <section aria-labelledby="new-taxonomy-heading" className="space-y-3">
        <h2 id="new-taxonomy-heading" className="text-sm font-medium text-foreground">
          New {label}
        </h2>
        <AdminForm
          schema={isCategory ? categoryFormSchema : platformFormSchema}
          serverAction={create}
          defaultValues={isCategory ? CATEGORY_FORM_DEFAULTS : PLATFORM_FORM_DEFAULTS}
          submitLabel={`Add ${label}`}
          onSuccess={() => router.refresh()}
        >
          <AdminFormField
            name="name"
            label="Name"
            required
            hint="The URL slug is generated from the name."
          />
          {isCategory ? (
            <AdminFormSelectField
              name="visibility"
              label="Visibility"
              options={CATEGORY_VISIBILITY_OPTIONS}
              required
            />
          ) : null}
        </AdminForm>
      </section>

      {failure ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {failure}
        </div>
      ) : null}

      <AdminDataTable
        caption={isCategory ? 'Categories' : 'Platforms'}
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname={pathname}
        state={state}
        empty={
          <p className="text-sm text-muted-foreground">No {label}s yet. Add the first one above.</p>
        }
      />

      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={next => {
          if (!next) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        isPending={pending !== null}
        title={`Delete ${deleting?.name ?? ''}?`}
        description="The row moves to the Trash. Existing associations are kept, so the usage history stays intact."
        affectedContent={
          <>
            Used by <strong>{deleting?.usageCount ?? 0}</strong>{' '}
            {deleting?.usageCount === 1 ? 'item' : 'items'}.
          </>
        }
        affectedContentLabel="Affected content"
        variant="destructive"
        confirmLabel="Delete"
        pendingLabel="Deleting…"
      />
    </div>
  );
}
