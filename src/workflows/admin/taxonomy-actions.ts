'use server';

import type { ActionResult } from '@/lib/contracts/common';
import {
  categoryFormSchema,
  platformFormSchema,
  reorderTaxonomyFormSchema,
  taxonomyIdFormSchema,
  updateCategoryFormSchema,
  updatePlatformFormSchema,
  type TaxonomyDto,
} from '@/lib/contracts/taxonomy-form';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { parseOrThrow } from '@/modules/content/validation';

import { toActionError } from '../action-errors';
import {
  createCategory,
  createPlatform,
  deleteCategory,
  deletePlatform,
  reorderCategories,
  reorderPlatforms,
  updateCategory,
  updatePlatform,
  type TaxonomyRow,
} from './taxonomy';

/**
 * Server Actions behind the category and platform admin screens.
 *
 * The actions resolve the actor and re-check the canonical permission; the
 * pages gate separately and never enforce access through navigation. Payloads
 * are re-validated here before the workflows run, and both a returned
 * `ok:false` error and a thrown value are mapped through the shared error
 * adapter so the client always receives the standard `ActionError`.
 */

function toTaxonomyDto(row: TaxonomyRow): TaxonomyDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    position: row.position,
    visibility: row.visibility,
    usageCount: row.usageCount,
  };
}

export async function createCategoryAction(input: unknown): Promise<ActionResult<TaxonomyDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'category.manage');

    const values = parseOrThrow(categoryFormSchema, input);

    const result = await createCategory(actor, {
      name: values.name,
      visibility: values.visibility,
    });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: toTaxonomyDto(result.category) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function updateCategoryAction(input: unknown): Promise<ActionResult<TaxonomyDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'category.manage');

    const values = parseOrThrow(updateCategoryFormSchema, input);

    const result = await updateCategory(actor, values.id, {
      name: values.name,
      visibility: values.visibility,
    });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: toTaxonomyDto(result.category) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function deleteCategoryAction(
  input: unknown
): Promise<ActionResult<{ usageCount: number }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'category.manage');

    const values = parseOrThrow(taxonomyIdFormSchema, input);

    const result = await deleteCategory(actor, values.id);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { usageCount: result.usageCount } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function reorderCategoriesAction(
  input: unknown
): Promise<ActionResult<{ reordered: number }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'category.manage');

    const values = parseOrThrow(reorderTaxonomyFormSchema, input);

    const result = await reorderCategories(actor, values.ids);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { reordered: result.reordered } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function createPlatformAction(input: unknown): Promise<ActionResult<TaxonomyDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'platform.manage');

    const values = parseOrThrow(platformFormSchema, input);

    const result = await createPlatform(actor, { name: values.name });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: toTaxonomyDto(result.platform) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function updatePlatformAction(input: unknown): Promise<ActionResult<TaxonomyDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'platform.manage');

    const values = parseOrThrow(updatePlatformFormSchema, input);

    const result = await updatePlatform(actor, values.id, { name: values.name });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: toTaxonomyDto(result.platform) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function deletePlatformAction(
  input: unknown
): Promise<ActionResult<{ usageCount: number }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'platform.manage');

    const values = parseOrThrow(taxonomyIdFormSchema, input);

    const result = await deletePlatform(actor, values.id);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { usageCount: result.usageCount } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function reorderPlatformsAction(
  input: unknown
): Promise<ActionResult<{ reordered: number }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'platform.manage');

    const values = parseOrThrow(reorderTaxonomyFormSchema, input);

    const result = await reorderPlatforms(actor, values.ids);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { reordered: result.reordered } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
