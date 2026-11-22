import 'server-only';

import { z } from 'zod';

import { requirePermission, type ActorContext, type PermissionKey } from '@/modules/authorization';
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_KINDS,
  type ImageContentType,
  type ImageKind,
} from '@/lib/contracts/media';
import { ValidationError } from '@/platform/errors';
import { storeImage } from '@/platform/media/storage';

/**
 * Image asset upload.
 *
 * The upload is an application operation, so the route is a thin adapter and
 * this workflow owns the authorization and the validation:
 *
 *   1. The content type and the image kind are parsed from untrusted input.
 *   2. The manage permission of that content type is required, so an
 *      administrator can only upload artwork for content they may manage.
 *   3. The platform storage service validates the bytes themselves (MIME
 *      type, file signature, size, and pixel dimensions) and writes the
 *      original to the managed directory.
 *
 * The permission is checked before the file is stored, so an unauthorized
 * upload never reaches the disk.
 */

/** Manage permission required for each target content type. */
const PERMISSION_BY_CONTENT_TYPE: Record<ImageContentType, PermissionKey> = {
  drama: 'drama.manage',
  movie: 'movie.manage',
};

const uploadRequestSchema = z.object({
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  kind: z.enum(IMAGE_KINDS),
});

export type ImageUploadRequest = {
  contentType: unknown;
  kind: unknown;
  file: File | null;
};

/** The stored original, as the API reports it. */
export type ImageUploadResult = {
  path: string;
  kind: ImageKind;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
};

/**
 * Store one uploaded original.
 *
 * @param actor - the administrator, resolved server-side from the session.
 * @param request - the untrusted multipart fields.
 */
export async function uploadImage(
  actor: ActorContext,
  request: ImageUploadRequest
): Promise<ImageUploadResult> {
  const parsed = uploadRequestSchema.safeParse({
    contentType: request.contentType,
    kind: request.kind,
  });

  if (!parsed.success) {
    throw new ValidationError('The upload request is invalid.', {
      contentType: ['The content type must be one of: drama, movie.'],
      kind: ['The image kind must be one of: poster, banner.'],
    });
  }

  requirePermission(actor, PERMISSION_BY_CONTENT_TYPE[parsed.data.contentType]);

  if (!(request.file instanceof File)) {
    throw new ValidationError('An image file is required.', {
      file: ['Choose an image file to upload.'],
    });
  }

  const stored = await storeImage({ kind: parsed.data.kind, file: request.file });

  return {
    path: stored.path,
    kind: stored.kind,
    contentType: stored.contentType,
    bytes: stored.bytes,
    width: stored.width,
    height: stored.height,
  };
}
