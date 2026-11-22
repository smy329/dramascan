import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { serverConfig } from '@/platform/config';
import { ValidationError } from '@/platform/errors';
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_KINDS,
  MANAGED_IMAGE_FILENAME_PATTERN,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MIN_IMAGE_DIMENSION,
  imageContentTypeForFilename,
  mediaPath,
  type AllowedImageMimeType,
  type ImageKind,
} from '@/lib/contracts/media';

/**
 * Original poster and banner storage.
 *
 * The application stores the uploaded file byte-for-byte. There is no Sharp,
 * no resizing, no conversion, and no optimisation: the browser receives the
 * exact original through the `/media` delivery route. Files live under
 * `IMAGE_STORAGE_DIR` (default `storage/images`), outside `src` and `.next`, so
 * an ordinary deployment does not delete them.
 */

export type StoredImage = Readonly<{
  path: string;
  kind: ImageKind;
  filename: string;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
}>;

type ImageDimensions = Readonly<{ width: number; height: number }>;

const MIME_BY_EXTENSION = new Map<string, string>(
  ALLOWED_IMAGE_TYPES.map(type => [type.extension, type.mimeType])
);

const ALLOWED_MIME_TYPES = new Set<string>(ALLOWED_IMAGE_TYPES.map(type => type.mimeType));

function storageRoot(): string {
  return serverConfig.imageStorageDir;
}

function kindDirectory(kind: ImageKind): string {
  return path.join(storageRoot(), kind);
}

function assertKind(kind: string): asserts kind is ImageKind {
  if (!(IMAGE_KINDS as readonly string[]).includes(kind)) {
    throw new ValidationError('Image kind must be poster or banner.', {
      kind: ['Image kind must be poster or banner.'],
    });
  }
}

/** Validate the magic bytes for the declared MIME type. */
function hasValidSignature(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    case 'image/png': {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
    }

    case 'image/gif': {
      const header = buffer.toString('ascii', 0, 6);
      return header === 'GIF87a' || header === 'GIF89a';
    }

    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
      );

    default:
      return false;
  }
}

/** Read image dimensions from the original bytes without decoding the image. */
export function readImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions | null {
  if (mimeType === 'image/png') {
    if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
      return null;
    }

    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (mimeType === 'image/gif') {
    if (buffer.length < 10) {
      return null;
    }

    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }

  if (mimeType === 'image/webp') {
    if (buffer.length < 30) {
      return null;
    }

    const chunk = buffer.toString('ascii', 12, 16);

    if (chunk === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }

    if (chunk === 'VP8 ' && buffer.length >= 30) {
      const startCode =
        buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a;

      if (!startCode) {
        return null;
      }

      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }

    if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);

      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + (bits >> 14 & 0x3fff),
      };
    }

    return null;
  }

  if (mimeType === 'image/jpeg') {
    let offset = 2;

    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = buffer[offset + 1] ?? 0;

      // Standalone markers carry no length segment.
      if (
        marker === 0x01 ||
        marker === 0xd8 ||
        marker === 0xd9 ||
        marker >= 0xd0 && marker <= 0xd7 ||
        marker === 0xff
      ) {
        offset += 2;
        continue;
      }

      const segmentLength = buffer.readUInt16BE(offset + 2);

      if (segmentLength < 2) {
        return null;
      }

      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

      if (isStartOfFrame) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }

      offset += 2 + segmentLength;
    }

    return null;
  }

  return null;
}

/**
 * Validate and persist one original image.
 *
 * `file` arrives from a multipart request. The server decides the filename and
 * extension from the validated MIME type, so a caller cannot choose a path or
 * smuggle an executable extension.
 */
export async function storeImage(input: {
  kind: ImageKind;
  file: File;
}): Promise<StoredImage> {
  const { kind, file } = input;
  assertKind(kind);

  if (file.size === 0) {
    throw new ValidationError('The image file is empty.', { file: ['Choose a non-empty image file.'] });
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new ValidationError('The image file is too large.', {
      file: ['The image must be 5 MB or smaller.'],
    });
  }

  const mimeType = file.type.toLowerCase();

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ValidationError('Unsupported image format.', {
      file: ['Use a JPEG, PNG, WebP, or GIF image.'],
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!hasValidSignature(buffer, mimeType)) {
    throw new ValidationError('The image file content does not match its declared format.', {
      file: ['The file signature is invalid for the selected image format.'],
    });
  }

  const dimensions = readImageDimensions(buffer, mimeType);

  if (dimensions === null || dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
    throw new ValidationError('The image dimensions are invalid.', {
      file: [`Images must be at least ${MIN_IMAGE_DIMENSION} by ${MIN_IMAGE_DIMENSION} pixels.`],
    });
  }

  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    throw new ValidationError('The image dimensions are invalid.', {
      file: [`Images must be at most ${MAX_IMAGE_DIMENSION} by ${MAX_IMAGE_DIMENSION} pixels.`],
    });
  }

  if (kind === 'poster' && dimensions.height < dimensions.width) {
    throw new ValidationError('A poster must use portrait proportions.', {
      file: ['Poster artwork must be portrait (height equal to or greater than width).'],
    });
  }

  if (kind === 'banner' && dimensions.width <= dimensions.height) {
    throw new ValidationError('A banner must use landscape proportions.', {
      file: ['Banner artwork must be landscape (width greater than height). Do not upload portrait artwork as a banner.'],
    });
  }

  const extension = ALLOWED_IMAGE_TYPES.find(type => type.mimeType === mimeType)?.extension;

  if (!extension) {
    throw new ValidationError('Unsupported image format.', { file: ['Use a supported image format.'] });
  }

  const filename = `${randomUUID()}.${extension}`;
  const directory = kindDirectory(kind);

  await mkdir(directory, { recursive: true });
  // The upload directory is a runtime value on purpose. The trace hint keeps
  // Turbopack from copying the whole project into the build output for it.
  await writeFile(path.join(/*turbopackIgnore: true*/ directory, filename), buffer, { flag: 'wx' });

  return Object.freeze({
    path: mediaPath(kind, filename),
    kind,
    filename,
    contentType: mimeType,
    bytes: buffer.byteLength,
    width: dimensions.width,
    height: dimensions.height,
  });
}

export type StoredImageFile = Readonly<{
  buffer: Buffer;
  contentType: string;
}>;

/**
 * Read one stored original for delivery.
 *
 * Only a server-generated filename inside a known kind directory is accepted.
 * `path.resolve` plus a prefix check rejects every traversal attempt, including
 * encoded separators that survive URL decoding.
 */
export async function readStoredImage(kind: string, filename: string): Promise<StoredImageFile | null> {
  if (!(IMAGE_KINDS as readonly string[]).includes(kind)) {
    return null;
  }

  if (!MANAGED_IMAGE_FILENAME_PATTERN.test(filename)) {
    return null;
  }

  const directory = kindDirectory(kind as ImageKind);
  const resolved = path.resolve(directory, filename);

  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    return null;
  }

  const contentType = imageContentTypeForFilename(filename);

  if (contentType === null) {
    return null;
  }

  try {
    return { buffer: await readFile(resolved), contentType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

/** Resolve the MIME type for a stored extension (used by tests). */
export function contentTypeForExtension(extension: string): string | null {
  return MIME_BY_EXTENSION.get(extension.toLowerCase()) ?? null;
}

export type { AllowedImageMimeType };
