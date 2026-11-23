/**
 * Administration module public API (server-only).
 *
 * The single public surface for the administration domain. Callers get the
 * operational-record service they are allowed to use, not the module's schema
 * or inner helpers.
 */

import 'server-only';

export { recordAdminAuditEvent, sanitizeAuditMetadata } from './audit-log';
export type { AdminAuditEventInput } from './audit-log';
