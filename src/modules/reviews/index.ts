/**
 * Reviews module public API (server-only).
 *
 * The single public surface for the reviews domain. Callers get the read
 * models they are allowed to use, not the module's schema or inner helpers.
 */

import 'server-only';

export { getRatingSummary } from './rating-summary';
export type { RatingSummary } from './rating-summary';
