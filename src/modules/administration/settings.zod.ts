import { z } from 'zod';

/**
 * Zod schema for system setting validation.
 * Keeps secrets out of ordinary configuration exports.
 */
export const settingSchema = z.object({
  key: z.string().describe('The canonical setting key'),
  description: z.string().nullable().optional().describe('Human-readable description'),
  booleanValue: z.boolean().nullable().optional().describe('Boolean switch value'),
  stringValue: z.string().nullable().optional().describe('Text string value'),
  jsonValue: z.unknown().nullable().optional().describe('Structured JSON value'),
  updatedBy: z.string().uuid().optional().describe('Administrator UUID who last changed the setting'),
  updatedAt: z.string().datetime().optional().describe('ISO 8601 timestamp of last update'),
});

export type SettingInput = z.infer<typeof settingSchema>;
export type SettingKey = keyof typeof settingSchema;

/**
 * Settings that must never be exported in plain-text configuration
 * (contains secrets, credentials, OAuth tokens, session secrets, etc.).
 */
export const SECRET_SETTING_KEYS = new Set([
  'better_auth_secret',
  'google_client_secret',
  'web_push_private_key',
  'web_push_subject', // could contain contact info
  'web_push_public_key', // paired with private key
  'fcm_server_key',
  'fcm_project_id',
  // Note: These are environment-level secrets, not stored in DB settings
]);

/**
 * Check whether a setting key contains sensitive/secrets data that should
 * be excluded from configuration exports.
 */
export function isSecretSettingKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_SETTING_KEYS.has(lower);
}

/**
 * Sanitize a setting value for safe export, redacting any secret-sensitive
 * fields. Returns a plain-object shape suitable for JSON serialization.
 */
export function sanitizeSettingForExport(
  input: { key: string; value: unknown } | null
): { key: string; safeValue: unknown } | null {
  if (!input) {
    return null;
  }

  const { key, value } = input;

  // If the key is a known secret, never expose the raw value
  if (isSecretSettingKey(key)) {
    return { key, safeValue: '<redacted>' };
  }

  // For known non-secret keys, pass the value through
  return { key, safeValue: value };
}
