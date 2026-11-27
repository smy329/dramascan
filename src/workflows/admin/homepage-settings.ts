'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import type { ActionResult } from '@/lib/contracts/common';
import {
  recordAdminAuditEvent,
  SYSTEM_SETTING_KEYS,
  updateSetting,
  type SettingContentRef,
} from '@/modules/administration';
import { resolveActor } from '@/modules/authorization';
import { getPublicContentTarget } from '@/modules/content';

import { toActionError } from '../action-errors';

/**
 * Homepage settings.
 *
 * The homepage reads three settings: the featured item, the hero rotation,
 * and the Trending pins. The administrators change them here.
 *
 * Two rules are enforced on the server:
 *
 *   - Every referenced item must still be publicly available. A setting that
 *     names an unpublished or trashed item would put it in front of the public
 *     the moment the content became public again without anybody choosing it.
 *   - The permission is re-checked inside the administration module, so the
 *     entrypoint is not the authority.
 */

/** The maximum number of items the hero may rotate through. */
const MAX_ROTATION_ITEMS = 12;

/** The maximum number of items that may be pinned into Trending. */
const MAX_TRENDING_PINS = 12;

/**
 * The entity type of an action on a global homepage setting.
 *
 * A setting is not a content row: it has no identifier to point at, so the
 * audit record names the setting itself and leaves the entity id empty. The
 * action that featured a piece of content is the one exception — there the
 * content really is the entity the administrator acted on.
 */
const HOMEPAGE_SETTING_ENTITY = 'homepage_setting';

/** One content reference as it arrives from a client. */
type RawContentRef = { type?: unknown; id?: unknown };

/**
 * Parse and validate a list of content references.
 *
 * Each reference is checked against the public availability rules, so a
 * setting can only ever name an item the public can already open.
 */
async function parseContentRefs(
  value: unknown,
  max: number
): Promise<{ ok: true; refs: SettingContentRef[] } | { ok: false; error: string }> {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'Invalid selection.' };
  }

  if (value.length > max) {
    return { ok: false, error: `Select at most ${max} items.` };
  }

  const refs: SettingContentRef[] = [];

  for (const entry of value as RawContentRef[]) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      entry.type !== 'drama' && entry.type !== 'movie' ||
      typeof entry.id !== 'string' ||
      entry.id.length === 0
    ) {
      return { ok: false, error: 'Invalid selection.' };
    }

    const target = await getPublicContentTarget(entry.type, entry.id);

    if (!target) {
      return { ok: false, error: 'One of the selected items is no longer available.' };
    }

    refs.push({ type: entry.type, id: entry.id });
  }

  return { ok: true, refs };
}

/** Choose the drama or movie the homepage hero shows. */
export async function updateFeaturedContentAction(input: unknown): Promise<
  ActionResult<{ type: 'drama' | 'movie'; id: string }>
> {
  try {
    const actor = await resolveActor();

    if (typeof input !== 'object' || input === null) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid selection.' } };
    }

    const payload = input as { type?: unknown; id?: unknown };
    const type = payload.type;
    const id = payload.id;

    if (type !== 'drama' && type !== 'movie' || typeof id !== 'string') {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid selection.' } };
    }

    const target = await getPublicContentTarget(type, id);

    if (!target) {
      return {
        ok: false,
        error: { code: 'not_found', message: 'That content is not publicly available.' },
      };
    }

    await db.transaction(async tx => {
      await updateSetting(actor, SYSTEM_SETTING_KEYS.featuredContentType, { stringValue: type }, tx);
      await updateSetting(actor, SYSTEM_SETTING_KEYS.featuredContent, { stringValue: id }, tx);

      await recordAdminAuditEvent(
        {
          actorId: actor.userId,
          action: 'homepage.featured.updated',
          entityType: type,
          entityId: id,
          summary: `Featured content set to ${target.title}`,
        },
        tx
      );
    });

    revalidatePath('/');
    revalidatePath('/admin/featured', 'page');

    return { ok: true, data: { type, id } };
  } catch (error) {
    console.error('[updateFeaturedContentAction] Error:', error);
    return { ok: false, error: toActionError(error) };
  }
}

/** Clear the featured selection so the homepage uses its automatic fallback. */
export async function clearFeaturedContentAction(): Promise<
  ActionResult<{ cleared: true }>
> {
  try {
    const actor = await resolveActor();

    await db.transaction(async tx => {
      await updateSetting(actor, SYSTEM_SETTING_KEYS.featuredContent, { stringValue: null }, tx);
      await updateSetting(actor, SYSTEM_SETTING_KEYS.featuredContentType, { stringValue: null }, tx);

      await recordAdminAuditEvent(
        {
          actorId: actor.userId,
          action: 'homepage.featured.cleared',
          entityType: HOMEPAGE_SETTING_ENTITY,
          entityId: null,
          summary: 'Featured content cleared; the homepage uses its automatic fallback',
        },
        tx
      );
    });

    revalidatePath('/');
    revalidatePath('/admin/featured', 'page');

    return { ok: true, data: { cleared: true } };
  } catch (error) {
    console.error('[clearFeaturedContentAction] Error:', error);
    return { ok: false, error: toActionError(error) };
  }
}

/** Turn the hero rotation on or off and set the items it rotates through. */
export async function updateHeroRotationAction(input: unknown): Promise<
  ActionResult<{ enabled: boolean; itemCount: number }>
> {
  try {
    const actor = await resolveActor();

    if (typeof input !== 'object' || input === null) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid selection.' } };
    }

    const payload = input as { enabled?: unknown; items?: unknown };
    const enabled = payload.enabled;

    if (typeof enabled !== 'boolean') {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid rotation state.' } };
    }

    const parsed = await parseContentRefs(payload.items, MAX_ROTATION_ITEMS);

    if (!parsed.ok) {
      return { ok: false, error: { code: 'validation_error', message: parsed.error } };
    }

    await db.transaction(async tx => {
      await updateSetting(actor, SYSTEM_SETTING_KEYS.heroRotationEnabled, { booleanValue: enabled }, tx);
      await updateSetting(actor, SYSTEM_SETTING_KEYS.heroRotationItems, { jsonValue: parsed.refs }, tx);

      await recordAdminAuditEvent(
        {
          actorId: actor.userId,
          action: 'homepage.hero_rotation.updated',
          entityType: HOMEPAGE_SETTING_ENTITY,
          entityId: null,
          summary: `Hero rotation ${enabled ? 'enabled' : 'disabled'} with ${parsed.refs.length} items`,
          metadata: { itemCount: parsed.refs.length },
        },
        tx
      );
    });

    revalidatePath('/');
    revalidatePath('/admin/hero-rotation', 'page');

    return { ok: true, data: { enabled, itemCount: parsed.refs.length } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Set the content items that are pinned into the Trending list. */
export async function updateTrendingPinsAction(input: unknown): Promise<
  ActionResult<{ itemCount: number }>
> {
  try {
    const actor = await resolveActor();

    const rawItems =
      typeof input === 'object' && input !== null ? (input as { items?: unknown }).items : input;

    const parsed = await parseContentRefs(rawItems, MAX_TRENDING_PINS);

    if (!parsed.ok) {
      return { ok: false, error: { code: 'validation_error', message: parsed.error } };
    }

    await db.transaction(async tx => {
      await updateSetting(
        actor,
        SYSTEM_SETTING_KEYS.trendingPinnedItems,
        { jsonValue: parsed.refs },
        tx
      );

      await recordAdminAuditEvent(
        {
          actorId: actor.userId,
          action: 'homepage.trending_pins.updated',
          entityType: HOMEPAGE_SETTING_ENTITY,
          entityId: null,
          summary: `Trending pins set to ${parsed.refs.length} items`,
          metadata: { itemCount: parsed.refs.length },
        },
        tx
      );
    });

    revalidatePath('/');
    revalidatePath('/trending', 'page');

    return { ok: true, data: { itemCount: parsed.refs.length } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
