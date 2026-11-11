import 'server-only';

import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  requirePermission,
  toPermissionKey,
  type ActorContext,
} from '@/modules/authorization';
import { NotFoundError } from '@/platform/errors';

import {
  buildFooterInformationLinks,
  informationPageIdSchema,
  isValidInformationPageSlug,
  listInformationPagesQuerySchema,
  parseOrThrow,
  reorderInformationPagesSchema,
  updateInformationPageSchema,
  type AdminInformationPage,
  type FooterInformationLink,
  type ListInformationPagesQuery,
  type PublicInformationPage,
} from './information-pages.shared';
import { information_pages } from './schema';

/**
 * Information pages (Terms, Privacy, Community Guidelines, Copyright/DMCA,
 * About, Contact) and their public footer links.
 *
 * Public reads only ever return published, non-deleted rows. Admin reads and
 * writes require `settings.manage`; the guard is applied both at the REST
 * entrypoint and here, because navigation is never an authorization boundary.
 *
 * Ordering uses the shared `position` column convention. Lower values appear
 * first; a null position sorts last.
 */

const MANAGE_PERMISSION = toPermissionKey('settings', 'manage');

/** Visible, published footer links in the administrator-controlled order. */
export async function listFooterInformationLinks(): Promise<FooterInformationLink[]> {
  const rows = await db
    .select({
      id: information_pages.id,
      title: information_pages.title,
      slug: information_pages.slug,
      publication_status: information_pages.publication_status,
      footer_visible: information_pages.footer_visible,
    })
    .from(information_pages)
    .where(
      and(
        isNull(information_pages.deleted_at),
        eq(information_pages.publication_status, 'published'),
        eq(information_pages.footer_visible, true)
      )
    )
    .orderBy(
      asc(information_pages.position),
      asc(information_pages.title),
      asc(information_pages.id)
    );

  return buildFooterInformationLinks(rows);
}

/** A published information page, or null for missing/hidden/invalid slugs. */
export async function getPublishedInformationPage(
  slug: string
): Promise<PublicInformationPage | null> {
  if (!isValidInformationPageSlug(slug)) {
    return null;
  }

  const [row] = await db
    .select({
      id: information_pages.id,
      title: information_pages.title,
      slug: information_pages.slug,
      content: information_pages.content,
      preview: information_pages.preview,
    })
    .from(information_pages)
    .where(
      and(
        eq(information_pages.slug, slug),
        eq(information_pages.publication_status, 'published'),
        isNull(information_pages.deleted_at)
      )
    )
    .limit(1);

  return row ?? null;
}

// ----- Admin API -------------------------------------------------------------

function toAdminInformationPage(row: typeof information_pages.$inferSelect): AdminInformationPage {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    content: row.content,
    publicationStatus: row.publication_status,
    preview: row.preview,
    footerVisible: row.footer_visible ?? false,
    position: row.position,
    updatedAt: row.updated_at.toISOString(),
  };
}

export type AdminInformationPageList = {
  pages: AdminInformationPage[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

/** List every non-deleted page for administration, including drafts. */
export async function listInformationPages(
  actor: ActorContext,
  query: ListInformationPagesQuery
): Promise<AdminInformationPageList> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsed = parseOrThrow(listInformationPagesQuerySchema, query);
  const offset = (parsed.page - 1) * parsed.pageSize;

  const [totalRow] = await db
    .select({ total: count() })
    .from(information_pages)
    .where(isNull(information_pages.deleted_at));

  const rows = await db
    .select()
    .from(information_pages)
    .where(isNull(information_pages.deleted_at))
    .orderBy(
      asc(information_pages.position),
      asc(information_pages.title),
      asc(information_pages.id)
    )
    .limit(parsed.pageSize)
    .offset(offset);

  const total = Number(totalRow?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / parsed.pageSize);

  return {
    pages: rows.map(toAdminInformationPage),
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
    totalPages,
    hasNextPage: parsed.page < totalPages,
    hasPreviousPage: parsed.page > 1 && totalPages > 0,
  };
}

/** Update one page's editable fields. Ordering is handled by the reorder service. */
export async function updateInformationPage(
  actor: ActorContext,
  pageId: string,
  input: unknown
): Promise<AdminInformationPage> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(informationPageIdSchema, pageId);
  const parsed = parseOrThrow(updateInformationPageSchema, input);

  const updates: Partial<typeof information_pages.$inferInsert> = {
    updated_at: new Date(),
  };

  if (parsed.title !== undefined) {
    updates.title = parsed.title;
  }
  if (parsed.content !== undefined) {
    updates.content = parsed.content;
  }
  if (parsed.publicationStatus !== undefined) {
    updates.publication_status = parsed.publicationStatus;
  }
  if (parsed.footerVisible !== undefined) {
    updates.footer_visible = parsed.footerVisible;
  }
  if (parsed.position !== undefined) {
    updates.position = parsed.position;
  }

  const [row] = await db
    .update(information_pages)
    .set(updates)
    .where(and(eq(information_pages.id, parsedId), isNull(information_pages.deleted_at)))
    .returning();

  if (!row) {
    throw new NotFoundError('Information page not found.');
  }

  return toAdminInformationPage(row);
}

/**
 * Set the display order of the supplied pages. The whole operation runs in one
 * transaction, so a failure cannot leave a partially reordered footer.
 *
 * Every supplied page must exist and be non-deleted. Pages not supplied keep
 * their current position; callers that want a strict total order should send
 * every page id.
 */
export async function reorderInformationPages(
  actor: ActorContext,
  input: unknown
): Promise<AdminInformationPage[]> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsed = parseOrThrow(reorderInformationPagesSchema, input);
  const orderedIds = parsed.ids;

  return db.transaction(async tx => {
    const existing = await tx
      .select({ id: information_pages.id })
      .from(information_pages)
      .where(
        and(inArray(information_pages.id, orderedIds), isNull(information_pages.deleted_at))
      );

    if (existing.length !== orderedIds.length) {
      throw new NotFoundError('One or more information pages were not found.');
    }

    const updatedAt = new Date();

    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(information_pages)
        .set({ position: index + 1, updated_at: updatedAt })
        .where(eq(information_pages.id, id));
    }

    const rows = await tx
      .select()
      .from(information_pages)
      .where(inArray(information_pages.id, orderedIds))
      .orderBy(asc(information_pages.position), asc(information_pages.title));

    return rows.map(toAdminInformationPage);
  });
}
