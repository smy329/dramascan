import { z } from 'zod';
import { parseListInformationPagesQuery } from '@/modules/content/information-pages.shared';

/** Slug pattern: lowercase alphanumeric plus hyphens, no leading/trailing hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 100;

/** Drama status enum. */
export const dramaStatusSchema = z.enum(['ongoing', 'completed']);

/** Drama create/edit schema. */
export const createDramaSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SLUG_LENGTH)
      .regex(SLUG_PATTERN, 'Slug must be lowercase alphanumeric with hyphens'),
    description: z.string().optional(),
    status: dramaStatusSchema.default('ongoing'),
  })
  .refine(
    value => Object.keys(value).length > 0,
    { message: 'At least one field must be provided.' }
  );

export type CreateDramaInput = z.infer<typeof createDramaSchema>;

/** Parse create drama input, throwing a REST-safe validation error on failure. */
export function parseCreateDramaInput(input: unknown): CreateDramaInput {
  return createDramaSchema.safeParse(input);
}

/** Parse a list query, throwing a REST-safe validation error on failure. */
export function parseListDramasQuery(input: unknown): unknown {
  // Reuse the information-page list query schema as a placeholder;
  // drama listing will add its own query params later.
  return parseListInformationPagesQuery(input);
}

/** Parse a single drama id, throwing a REST-safe validation error on failure. */
export function parseDramaId(input: unknown): string {
  return z.uuid().safeParse(input).data;
}

/** Shared parse-or-throw helper (ported from information-pages.shared.ts). */
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

/** Validation error class matching the platform convention. */
export class ValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]>) {
    super(message);
    this.fieldErrors = fieldErrors;
    this.name = 'ValidationError';
  }
}