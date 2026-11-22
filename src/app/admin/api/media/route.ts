import 'server-only';

import { requireAdmin, resolveActor } from '@/modules/authorization';
import { MAX_IMAGE_BYTES } from '@/lib/contracts/media';
import { ValidationError } from '@/platform/errors';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from '@/platform/Http/admin-route';
import { uploadImage } from '@/workflows/admin/media';

/**
 * Poster and banner upload endpoint.
 *
 * A multipart request carries `contentType` (drama or movie), `kind` (poster
 * or banner), and one `file`. The route is a thin adapter: it resolves the
 * actor, refuses a request that is not made by an administrator before the
 * body is read, and delegates the permission check, the format validation, and
 * the storage to the upload workflow.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'media');

  try {
    assertSameOrigin(request);

    const contentLength = Number(request.headers.get('content-length') ?? '0');

    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES + 1024 * 1024) {
      throw new ValidationError('The image file is too large.', {
        file: ['The image must be 5 MB or smaller.'],
      });
    }

    const actor = await resolveActor();

    // The coarse guard runs before the body is read, so a request that is not
    // made by an administrator never buffers an upload.
    requireAdmin(actor);

    let form: FormData;

    try {
      form = await request.formData();
    } catch {
      throw new ValidationError('The upload must be a multipart form request.');
    }

    const file = form.get('file');

    const stored = await uploadImage(actor, {
      contentType: form.get('contentType'),
      kind: form.get('kind'),
      file: file instanceof File ? file : null,
    });

    return jsonResponse({ data: stored }, 201, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'media');
  }
}
