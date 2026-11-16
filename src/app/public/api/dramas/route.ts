import 'server-only';

import { db } from '@/db/client';
import { dramas } from '@/modules/content/schema';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Public drama listing API.
 *
 * Fetches non-deleted dramas, ordered by title. Optionally filters by
 * visibility mode and/or publication status. No admin authorization required:
 * this endpoint is intentionally open for the public-facing drama catalogue.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const visibility = searchParams.get('visibility') as 'coming_soon' | 'hidden' | null;

  const publicationStatus = searchParams.get('publication_status') as
    'draft' | 'published' | 'unpublished' | null;

  const whereConditions: any[] = [isNull(dramas.deleted_at)];

  if (visibility) {
    whereConditions.push(eq(dramas.visibility, visibility));
  }

  if (publicationStatus) {
    whereConditions.push(eq(dramas.publication_status, publicationStatus));
  }

  const rows = await db
    .select()
    .from(dramas)
    .where(and(...whereConditions))
    .orderBy(dramas.title);

  return new Response(
    JSON.stringify({
      data: rows,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }
  );
}
