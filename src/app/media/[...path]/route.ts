import 'server-only';

import { readStoredImage } from '@/platform/media/storage';

/**
 * Direct delivery of stored original artwork.
 *
 * Files are served from `IMAGE_STORAGE_DIR`, never through `next/image`, Sharp,
 * or a conversion pipeline. Only a server-generated `{kind}/{uuid}.{ext}` pair
 * is accepted, so the route cannot read application source, configuration, or
 * arbitrary filesystem paths. Filenames are immutable, which makes a one-year
 * browser cache safe.
 */

export const dynamic = 'force-dynamic';

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function resolve(segments: readonly string[]): Promise<Response> {
  if (segments.length !== 2) {
    return notFound();
  }

  const [kind, filename] = segments;

  if (kind === undefined || filename === undefined) {
    return notFound();
  }

  const file = await readStoredImage(kind, filename);

  if (file === null) {
    return notFound();
  }

  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.buffer.byteLength),
      'Cache-Control': IMMUTABLE_CACHE,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await context.params;

  return resolve(path);
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const response = await resolve((await context.params).path);

  return new Response(null, { status: response.status, headers: response.headers });
}
