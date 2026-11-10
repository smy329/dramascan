import * as administration from '@/modules/administration/schema';
import * as analytics from '@/modules/analytics/schema';
import * as auth from '@/modules/auth/schema';
import * as authorization from '@/modules/authorization/schema';
import * as content from '@/modules/content/schema';
import * as maintenance from '@/modules/maintenance/schema';
import * as moderation from '@/modules/moderation/schema';
import * as notifications from '@/modules/notifications/schema';
import * as playback from '@/modules/playback/schema';
import * as reviews from '@/modules/reviews/schema';
import * as users from '@/modules/users/schema';

/**
 * Drizzle schema registry.
 *
 * This is the composition root for domain schemas: it is the only file allowed
 * to import module `schema.ts` files. Each module owns its tables and exports
 * them directly; the registry picks them up without any module importing
 * another module's schema.
 *
 * Tables are added by the data-model prompts. Cross-module foreign keys are
 * declared in SQL migrations, not here, so the registry stays free of
 * cross-module coupling.
 */
export const schema = {
  ...administration,
  ...analytics,
  ...auth,
  ...authorization,
  ...content,
  ...maintenance,
  ...moderation,
  ...notifications,
  ...playback,
  ...reviews,
  ...users,
};

export type Schema = typeof schema;

/**
 * Direct table exports for migration tooling.
 *
 * `drizzle-kit` discovers tables from the schema file's direct exports; it does
 * not traverse the nested `schema` registry above. Re-exporting every domain
 * schema keeps a single composition root for both the runtime client and
 * migration generation.
 */
export * from '@/modules/administration/schema';
export * from '@/modules/analytics/schema';
export * from '@/modules/auth/schema';
export * from '@/modules/authorization/schema';
export * from '@/modules/content/schema';
export * from '@/modules/maintenance/schema';
export * from '@/modules/moderation/schema';
export * from '@/modules/notifications/schema';
export * from '@/modules/playback/schema';
export * from '@/modules/reviews/schema';
export * from '@/modules/users/schema';
