/**
 * Analytics module public API (server-only).
 *
 * The single public surface for the analytics domain. Callers get the
 * read models they are allowed to use, not the module's schema or inner
 * helpers.
 */

import 'server-only';

export { getContentViewCount } from './view-counts';
