import 'server-only';

import { beginAdminRequest, errorResponse, jsonResponse } from '@/platform/Http';
import { listSearchSuggestions } from '@/modules/content';

/**
 * The live search suggestions.
 *
 * The route is a thin read adapter: it reads the query term from the URL and
 * hands it to the content module, which decides what the public may see. An
 * unpublished or trashed item is never suggested.
 *
 * The route is a `GET`, so it needs no same-origin check and no actor: the
 * suggestions are public information.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The longest term the route accepts. */
const MAX_QUERY_LENGTH = 100;

export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'search');

  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get('q') ?? '';
    const term = raw.trim().slice(0, MAX_QUERY_LENGTH);

    const suggestions = await listSearchSuggestions(term, { limit: 8 });

    return jsonResponse({ data: { suggestions } }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'search');
  }
}
