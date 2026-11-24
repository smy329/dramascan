import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import type { DbExecutor } from '@/platform/db/executor';

import { system_settings } from './schema';
import {
  parseSettingContentRefs,
  SYSTEM_SETTING_KEYS,
  type SettingContentRef,
} from './settings.shared';

/**
 * System settings.
 *
 * A setting is a single row identified by its key. The value lives in the
 * column that matches its type, so a switch is read as a boolean and a text
 * setting is read as a string. There is no generic "any value" column to
 * misread.
 */

export {
  parseSettingContentRefs,
  SYSTEM_SETTING_KEYS,
} from './settings.shared';
export type { SettingContentRef, SystemSettingKey } from './settings.shared';

/** One setting row. */
export type SystemSetting = {
  key: string;
  description: string | null;
  booleanValue: boolean | null;
  stringValue: string | null;
  value: unknown;
  updatedAt: Date;
};

/**
 * The homepage hero selection.
 *
 * `null` means nothing was selected, or the stored selection is malformed;
 * the caller then uses the automatic fallback.
 */
export async function getFeaturedContentSetting(
  executor: DbExecutor = db
): Promise<SettingContentRef | null> {
  const [idSetting, typeSetting] = await Promise.all([
    getSetting(SYSTEM_SETTING_KEYS.featuredContent, executor),
    getSetting(SYSTEM_SETTING_KEYS.featuredContentType, executor),
  ]);

  const id = idSetting?.stringValue;
  const type = typeSetting?.stringValue;

  if (!id || type !== 'drama' && type !== 'movie') {
    return null;
  }

  return { type, id };
}

/**
 * The hero rotation setting.
 *
 * The rotation is off unless the administrator turned it on. The eligible
 * items are the extra ones the administrator picked; the featured item itself
 * is always the first slide.
 */
export async function getHeroRotationSetting(
  executor: DbExecutor = db
): Promise<{ enabled: boolean; items: SettingContentRef[] }> {
  const [enabledSetting, itemsSetting] = await Promise.all([
    getSetting(SYSTEM_SETTING_KEYS.heroRotationEnabled, executor),
    getSetting(SYSTEM_SETTING_KEYS.heroRotationItems, executor),
  ]);

  return {
    enabled: enabledSetting?.booleanValue === true,
    items: parseSettingContentRefs(itemsSetting?.value),
  };
}

/**
 * The content items an administrator pinned into the Trending list.
 */
export async function getTrendingPinsSetting(
  executor: DbExecutor = db
): Promise<SettingContentRef[]> {
  const setting = await getSetting(SYSTEM_SETTING_KEYS.trendingPinnedItems, executor);

  return parseSettingContentRefs(setting?.value);
}

/**
 * Read one setting.
 *
 * Returns `null` when the setting has never been written; the caller then
 * applies the documented default.
 */
export async function getSetting(
  key: string,
  executor: DbExecutor = db
): Promise<SystemSetting | null> {
  const [row] = await executor
    .select({
      key: system_settings.key,
      description: system_settings.description,
      booleanValue: system_settings.boolean_value,
      stringValue: system_settings.string_value,
      value: system_settings.value,
      updatedAt: system_settings.updated_at,
    })
    .from(system_settings)
    .where(eq(system_settings.key, key))
    .limit(1);

  return row ?? null;
}

/**
 * Write one setting.
 *
 * @param actor The administrator. The service checks `settings.manage` itself.
 * @param key The setting key.
 * @param value The new value. Exactly one of the typed columns is written.
 */
export async function updateSetting(
  actor: ActorContext,
  key: string,
  value: { boolean?: boolean | null; string?: string | null; json?: unknown },
  executor: DbExecutor = db
): Promise<SystemSetting> {
  requirePermission(actor, 'settings.manage');

  const [row] = await executor
    .insert(system_settings)
    .values({
      key,
      boolean_value: value.boolean ?? null,
      string_value: value.string ?? null,
      value: value.json ?? null,
      updated_by: actor.userId,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        boolean_value: value.boolean ?? null,
        string_value: value.string ?? null,
        value: value.json ?? null,
        updated_by: actor.userId,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      description: system_settings.description,
      booleanValue: system_settings.boolean_value,
      stringValue: system_settings.string_value,
      value: system_settings.value,
      updatedAt: system_settings.updated_at,
    });

  if (!row) {
    throw new Error('The setting could not be saved.');
  }

  return row;
}
