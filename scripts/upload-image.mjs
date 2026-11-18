/**!
 * eslint-disable-next-line eslint/no-restricted-globals
 */
/** 
 * Image upload helper for DramaScan.
 *
 * Uploads an image file to the persistent server disk and returns a relative path.
 * - Stores under public/assets/images/dramas/{unique-filename}
 * - Uses UUID for safe, unique filenames
 * - Validates image format, size, and file signature (magic bytes)
 * - NO server-side image processing — stores the original file as-is
 * - NO Sharp, NO server-side resizing, NO image optimization
 * - Preserves original image and maintains portrait proportions (dimensions reported)
 *
 * Usage (in a Server Action):
 *   const formData = await request.formData();
 *   const posterFile = formData.get('poster') as File;
 *   const path = await uploadImage(posterFile);
 *   // path example: "/assets/images/dramas/abc123def456.jpg"
 */

import { v4 as uuidv4 } from 'uuid';
import { writeFile } from 'node:fs/promises';
import { File } from 'node:stream/consumers';

/** Base directory for all DramaScan image assets (relative to Next.js public folder). */
const BASE_DIR = '/assets/images/dramas';

/** Allowed image MIME types. */
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

/** Maximum image file size in bytes (5MB). */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Minimum image dimensions. */
const MIN_DIMENSIONS = { width: 100, height: 100 };

/** Maximum image dimensions. */
const MAX_DIMENSIONS = { width: 4000, height: 4000 };

/** File signature (magic bytes) mappings for format validation. */
const FILE_SIGNATURES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF chunk; full check below
  gif: [0x47, 0x49, 0x46, 0x38],
};

/** Validate that the file's MIME type is in the allowed list. */
function isAllowedMimeType(type: string): type is (typeof ALLOWED_MIME_TYPES)[number] {
  return ALLOWED_MIME_TYPES.includes(type as (typeof ALLOWED_MIME_TYPES)[number]);
}

/** Validate the file signature (magic bytes) to confirm the file type. */
function validateFileSignature(buffer: Buffer, mimeType: string): boolean {
  const sig = FILE_SIGNATURES[mimeType as keyof typeof FILE_SIGNATURES];
  if (!sig) return false;

  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === sig[0] && buffer[1] === sig[1] && buffer[2] === sig[2];
  }

  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === sig[0] &&
      buffer[1] === sig[1] &&
      buffer[2] === sig[2] &&
      buffer[3] === sig[3] &&
      buffer[4] === sig[4] &&
      buffer[5] === sig[5] &&
      buffer[6] === sig[6] &&
      buffer[7] === sig[7]
    );
  }

  if (mimeType === 'image/gif') {
    return buffer.length >= 4 && buffer[0] === sig[0] && buffer[1] === sig[1] && buffer[2] === sig[2] && buffer[3] === sig[3];
  }

  if (mimeType === 'image/webp') {
    // WebP: RIFF chunk + VP8/VP9 header
    // Check for 'RIFF' header at offset 0 and 'WEBP' at offset 8
    return (
      buffer.length >= 12 &&
      buffer[0] === 0x52 && // 'R'
      buffer[1] === 0x49 && // 'I'
      buffer[2] === 0x46 && // 'F'
      buffer[3] === 0x46 && // 'F'
      buffer[8] === 0x57 && // 'W'
      buffer[9] === 0x45 && // 'E'
      buffer[10] === 0x42 && // 'B'
      buffer[11] === 0x0e // indicates VP8/VP9
    );
  }

  return false;
}

/** Extract image dimensions from the file buffer without decoding the full image. */
function extractDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/jpeg') {
      // JPEG SOF0 marker: marker(0xff+0xc0), then 2 bytes length, then 2 bytes height, 2 bytes width
      for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xff && buffer[i + 1] === 0xc0) {
          // SOF0 marker found
          const height = buffer[i + 5] << 8 | buffer[i + 6];
          const width = buffer[i + 7] << 8 | buffer[i + 8];
          return { width, height };
        }
      }
    } else if (mimeType === 'image/png') {
      // PNG IHDR chunk: after 8-byte signature, 4-byte length, then 4 bytes width, 4 bytes height
      if (buffer.length >= 24) {
        const width =
          (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
        const height =
          (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    } else if (mimeType === 'image/gif') {
      // GIF logical screen width: bytes 6-7 (big-endian), height: bytes 8-9
      if (buffer.length >= 10) {
        const width = buffer[6] << 8 | buffer[7];
        const height = buffer[8] << 8 | buffer[9];
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    } else if (mimeType === 'image/webp') {
      // WebP: VP8/VP9 frame header at offset 24
      // Width: bytes 24-27 (big-endian), Height: bytes 28-31
      if (buffer.length >= 32) {
        const width = buffer[24] << 24 | buffer[25] << 16 | buffer[26] << 8 | buffer[27];
        const height = buffer[28] << 24 | buffer[29] << 16 | buffer[30] << 8 | buffer[31];
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Upload a single image file to the persistent server disk. */