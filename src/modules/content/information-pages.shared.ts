import { z } from 'zod';

import { ValidationError } from '@/platform/errors';

/**
 * Pure information-page contracts: canonical slugs, route building, footer
 * projection, and admin input validation.
 *
 * This file deliberately imports no database or authentication code so the
 * rules can be unit-tested without a running PostgreSQL instance. The service
 * in `information-pages.ts` owns persistence and authorization.
 */

/** Canonical starting set. The seed migration mirrors these slugs and titles. */
export const INFORMATION_PAGE_DEFINITIONS = [
  { title: 'Terms of Service', slug: 'terms', position: 1 },
  { title: 'Privacy Policy', slug: 'privacy', position: 2 },
  { title: 'Community Guidelines', slug: 'community-guidelines', position: 3 },
  { title: 'Copyright / DMCA', slug: 'copyright-dmca', position: 4 },
  { title: 'About', slug: 'about', position: 5 },
  { title: 'Contact', slug: 'contact', position: 6 },
] as const;

const INFORMATION_PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 100;

/** Slug values that can be used as a single public URL segment. */
export function isValidInformationPageSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && INFORMATION_PAGE_SLUG_PATTERN.test(slug);
}

/** The canonical public route for an information page. */
export function informationPageHref(slug: string): string {
  return `/information/${slug}`;
}

export type FooterInformationLink = {
  id: string;
  slug: string;
  label: string;
  href: string;
};

export type PublicInformationPage = {
  id: string;
  title: string;
  slug: string;
  content: string;
  preview: string | null;
};

export type AdminInformationPage = {
  id: string;
  title: string;
  slug: string;
  content: string;
  publicationStatus: string | null;
  preview: string | null;
  footerVisible: boolean;
  position: number | null;
  updatedAt: string;
};

type FooterRow = {
  id: string;
  title: string;
  slug: string;
  publication_status: string | null;
  footer_visible: boolean | null;
};

/**
 * Convert query rows into footer links, dropping anything a public footer must
 * never expose: non-published pages, hidden pages, and malformed slugs.
 */
export function buildFooterInformationLinks(rows: readonly FooterRow[]): FooterInformationLink[] {
  const links: FooterInformationLink[] = [];

  for (const row of rows) {
    if (row.publication_status !== 'published' || row.footer_visible !== true) {
      continue;
    }
    if (!isValidInformationPageSlug(row.slug)) {
      continue;
    }

    links.push({
      id: row.id,
      slug: row.slug,
      label: row.title,
      href: informationPageHref(row.slug),
    });
  }

  return links;
}

// ----- Validation ------------------------------------------------------------

export const listInformationPagesQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const informationPageIdSchema = z.uuid();

const publicationStatusSchema = z.enum(['draft', 'published', 'unpublished']);

export const updateInformationPageSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().min(1).max(200_000).optional(),
    publicationStatus: publicationStatusSchema.nullable().optional(),
    footerVisible: z.boolean().optional(),
    position: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .refine(value => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  });

export const reorderInformationPagesSchema = z
  .strictObject({
    ids: z.array(z.uuid()).min(1).max(500),
  })
  .refine(value => new Set(value.ids).size === value.ids.length, {
    message: 'IDs must be unique.',
    path: ['ids'],
  });

export type UpdateInformationPageInput = z.infer<typeof updateInformationPageSchema>;
export type ReorderInformationPagesInput = z.infer<typeof reorderInformationPagesSchema>;
export type ListInformationPagesQuery = z.infer<typeof listInformationPagesQuerySchema>;

export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : 'form';
      const messages = fieldErrors[field] ?? [];
      messages.push(issue.message);
      fieldErrors[field] = messages;
    }

    throw new ValidationError('The request contains invalid fields.', fieldErrors);
  }

  return parsed.data;
}

/** Parse a list query, throwing a REST-safe validation error on failure. */
export function parseListInformationPagesQuery(input: unknown): ListInformationPagesQuery {
  return parseOrThrow(listInformationPagesQuerySchema, input);
}

/** Parse a single page id, throwing a REST-safe validation error on failure. */
export function parseInformationPageId(input: unknown): string {
  return parseOrThrow(informationPageIdSchema, input);
}
