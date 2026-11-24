/**
 * Administration module public API (server-only).
 *
 * The single public surface for the administration domain. Callers get the
 * operational-record service and the system settings they are allowed to use,
 * not the module's schema or inner helpers.
 */

import 'server-only';

export { recordAdminAuditEvent, sanitizeAuditMetadata } from './audit-log';
export type { AdminAuditEventInput } from './audit-log';

export {
  getFeaturedContentSetting,
  getHeroRotationSetting,
  getSetting,
  getTrendingPinsSetting,
  updateSetting,
} from './settings';
export { parseSettingContentRefs, SYSTEM_SETTING_KEYS } from './settings.shared';
export type {
  SettingContentRef,
  SystemSetting,
  SystemSettingKey,
} from './settings';
