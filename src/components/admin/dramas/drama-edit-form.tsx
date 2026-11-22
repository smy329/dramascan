'use client';

import type { JSX } from 'react';
import { useRouter } from 'next/navigation';

import { AdminForm } from '@/components/admin/forms/admin-form';
import { dramaFormSchema, type DramaTaxonomyOption } from '@/lib/contracts/drama-form';
import { updateDramaAction } from '@/workflows/admin/drama-actions';

import { DramaFormFields } from './drama-create-form';

export type DramaEditFormProps = Readonly<{
  dramaId: string;
  defaultValues: Readonly<Record<string, unknown>>;
  categories: readonly DramaTaxonomyOption[];
  platforms: readonly DramaTaxonomyOption[];
}>;

/** Admin form for editing a drama's metadata, visibility, artwork, and taxonomy. */
export function DramaEditForm({
  dramaId,
  defaultValues,
  categories,
  platforms,
}: DramaEditFormProps): JSX.Element {
  const router = useRouter();

  return (
    <AdminForm
      schema={dramaFormSchema}
      serverAction={values => updateDramaAction(dramaId, values)}
      defaultValues={defaultValues}
      resetOnSuccess={false}
      submitLabel="Save drama"
      pendingLabel="Saving…"
      onSuccess={() => {
        router.push(`/admin/dramas/${dramaId}`);
        router.refresh();
      }}
    >
      <DramaFormFields categories={categories} platforms={platforms} structureLocked />
    </AdminForm>
  );
}
