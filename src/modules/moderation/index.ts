/**
 * Moderation module public API (server-only).
 *
 * The single public surface for the moderation domain. Callers get the audit
 * trail they are allowed to read and write, not the module's schema or inner
 * helpers.
 */

import 'server-only';

export { listModerationActions, recordModerationAction } from './service';
export type { ModerationAction } from './service';

export {
  MODERATION_ACTION_TYPES,
  MODERATION_TARGET_TYPES,
} from './schema';

export type { ModerationActionType, ModerationTargetType } from './schema';
