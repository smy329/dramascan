import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import type { DbExecutor } from '@/platform/db/executor';

import { system_settings } from './schema';
import {
  validateSettingInput,
  sanitizeSettingForExport,
  isSecretSettingKey,
  SYSTEM_SETTING_KEYS,
  type SettingContentRef,
  parseSettingContentRefs,
  type SystemSettingKey,
  type SettingInput,
} from './settings.shared';

/**
 * System settings.
 *
 * A setting is a single row identified by its key. The value lives in the
 * column that matches its type, so a switch is read as a boolean and a text
 * setting is read as a string. There is no generic "any value" column to
 * misread. Settings are validated through Zod before being written to the
 * database, and secrets are excluded from configuration exports.
 *
 * Every setting row is identified by its canonical `key`. Exactly one of
 * `boolean_value`, `string_value`, or `value` (JSON) is populated per row.
 */

/** One setting row, validated and typed, matching the database schema. */
export type SystemSetting = {
  key: string;
  description: string | null;
  booleanValue: boolean | null;
  stringValue: string | null;
  /** @deprecated Use jsonValue instead. Kept for database compatibility. */
  value: unknown | null;
  jsonValue: unknown | null; // The actual JSON/structured value column
  updatedBy: string | null;
  updatedAt: Date;
};

/**
 * Validate a setting input against the canonical Zod schema.
 * The caller must hold `settings.manage` permission.
 */
function validateAndParseSetting(input: unknown): SettingInput {
  return validateSettingInput(input);
}

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
 * Read one setting, returning the validated typed value.
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
      // Select both value (for DB compat) and jsonValue
      value: system_settings.value,
      jsonValue: system_settings.value,
      updatedBy: system_settings.updated_by,
      updatedAt: system_settings.updated_at,
    })
    .from(system_settings)
    .where(eq(system_settings.key, key))
    .limit(1);

  return row ?? null;
}

/** Exported types for the administration module public API. */
export type { SystemSettingKey } from './settings.shared'; // eslint-disable-line no-unused-vars
export type { SettingContentRef } from './settings.shared';

/**
 * Write one setting with Zod validation.
 *
 * @param actor The administrator. The service checks `settings.manage` itself.
 * @param key The setting key.
 * @param value The new value validated through Zod.
 */
export async function updateSetting(
  actor: ActorContext,
  key: string,
  value: { boolean?: boolean | null; string?: string | null; json?: unknown },
  executor: DbExecutor = db
): Promise<SystemSetting> {
  requirePermission(actor, 'settings.manage');

  // Validate the input through Zod before touching the database
  const parsed = validateAndParseSetting(value);

  const [row] = await executor
    .insert(system_settings)
    .values({
      key,
      description: parsed.description ?? null,
      boolean_value: parsed.booleanValue ?? null,
      string_value: parsed.stringValue ?? null,
      value: parsed.jsonValue ?? null,
      updated_by: actor.userId,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        description: parsed.description ?? null,
        boolean_value: parsed.booleanValue ?? null,
        string_value: parsed.stringValue ?? null,
        value: parsed.jsonValue ?? null,
        updated_by: actor.userId,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      description: system_settings.description,
      booleanValue: system_settings.boolean_value,
      stringValue: system_settings.string_value,
      // Include both value (for DB compat) and jsonValue
      value: system_settings.value,
      jsonValue: system_settings.value,
      updatedBy: system_settings.updated_by,
      updatedAt: system_settings.updated_at,
    });

  if (!row) {
    throw new Error('The setting could not be saved.');
  }

  return row;
}

/**
 * Export system configuration as safe JSON, redacting any secret-sensitive
 * setting values. Only non-secret keys are included in the export.
 *
 * Returns a plain-object shape suitable for JSON serialization. Secret-sensitive
 * values are replaced with '<redacted>'.
 */
export async function exportConfiguration(): Promise<
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string }
> {
  try {
    // Select with explicit aliases to match the SystemSetting type shape
    const allRows = await db
      .select({
        key: system_settings.key,
        description: system_settings.description,
        booleanValue: system_settings.boolean_value,
        stringValue: system_settings.string_value,
        // Map jsonb 'value' column to jsonValue for type compatibility
        jsonValue: system_settings.value,
        updatedBy: system_settings.updated_by,
        updatedAt: system_settings.updated_at,
      })
      .from(system_settings)
      .orderBy(system_settings.key);

    const data: Record<string, unknown> = {};

    for (const row of allRows) {
      const safeValue =
        row.booleanValue !== null
          ? row.booleanValue
          : row.stringValue !== null
          ? row.stringValue
          : row.jsonValue;

      const sanitized = sanitizeSettingForExport({
        key: row.key,
        value: safeValue,
      });

      if (sanitized && !isSecretSettingKey(sanitized.key)) {
        data[sanitized.key] = sanitized.safeValue;
      }
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during export',
    };
  }
}

/**
 * Import system configuration from a partial JSON object.
 * Secret-sensitive keys are silently skipped. Each attempted import is
 * validated before applying; failures are collected and reported.
 *
 * @param newSettings Partial object of key/value pairs to import.
 * @param actor The administrator performing the import.
 */
export async function importConfiguration(
  newSettings: Record<string, unknown>,
  actor: ActorContext
): Promise<{ success: boolean; message: string; errors: string[] }> {
  requirePermission(actor, 'settings.manage');

  const errors: string[] = [];
  const applied: string[] = [];

  for (const [key, rawValue] of Object.entries(newSettings)) {
    // Skip known secret keys
    if (isSecretSettingKey(key)) {
      errors.push(`Skipping secret setting: ${key}`);
      continue;
    }

    try {
      // Validate and normalize the value
      const parsed = validateSettingInput({
        key,
        booleanValue: typeof rawValue === 'boolean' ? rawValue : undefined,
        stringValue: typeof rawValue === 'string' ? rawValue : undefined,
        jsonValue:
          typeof rawValue === 'object' && rawValue !== null ? rawValue : undefined,
      });

      // Apply the setting
      await updateSetting(actor, key, {
        boolean: parsed.booleanValue ?? null,
        string: parsed.stringValue ?? null,
        json: parsed.jsonValue ?? null,
      });

      applied.push(key);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown validation error';
      errors.push(`Failed to apply ${key}: ${errorMessage}`);
    }
  }

  if (errors.length > 0 && applied.length === 0) {
    return { success: false, message: 'No settings were applied', errors };
  }

  return {
    success: errors.length === 0,
    message:
      applied.length > 0
        ? `Applied ${applied.length} setting${applied.length === 1 ? '' : 's'}`
        : 'No new settings applied',
    errors,
  };
}'' 
