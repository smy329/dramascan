import { type ActionResult } from '@/lib/contracts/common';
import { resolveActor } from '@/modules/authorization';

import { createDrama } from './dramas';

/** Server Action behind the admin drama create form. */
export async function createDramaAction(
  _payload: unknown
): Promise<ActionResult<{ id: string; title: string; slug: string; structure_type: string }>> {
  try {
    const payload = _payload as Record<string, unknown>;

    // Resolve the actor from the session/context
    const actor = await resolveActor();

    // Extract poster file from values (react-hook-form includes File objects for type="file" inputs)
    const posterFile = payload.poster instanceof File ? payload.poster as File : null;

    // Build text payload (exclude poster - handled separately)
    const textPayload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key !== 'poster' && typeof value === 'string') {
        textPayload[key] = value;
      }
    }

    // Upload poster image to persistent server disk
    let posterPath: string | null = null;
    if (posterFile) {
      const { uploadImage } = await import('@/scripts/upload-image');
      const { path: uploadedPath } = await uploadImage(posterFile);
      posterPath = uploadedPath;
    }

    // Extract banner file from values (react-hook-form includes File objects for type="file" inputs)
    const bannerFile = payload.banner instanceof File ? payload.banner as File : null;

    // Upload banner image to persistent server disk
    let bannerPath: string | null = null;
    if (bannerFile) {
      const { uploadImage } = await import('@/scripts/upload-image');
      const { path: uploadedPath } = await uploadImage(bannerFile);
      bannerPath = uploadedPath;
    }

    // Merge text payload with poster and banner paths and actor
    const finalPayload = {
      ...textPayload,
      poster: posterPath,
      banner: bannerPath,
    };

    // Create the drama
    const result = await createDrama(actor, finalPayload);

    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: 'drama_creation_error',
          message: String(result.error),
        },
      };
    }

    return {
      ok: true,
      data: {
        id: result.drama.id,
        title: result.drama.title,
        slug: result.drama.slug,
        structure_type: result.drama.structure_type,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'drama_creation_error',
        message: error.message || 'Unknown error during drama creation',
      },
    };
  }
}

