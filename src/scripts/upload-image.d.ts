// Type declarations for scripts/upload-image.mjs
// This file provides TypeScript types for the dynamic import of upload-image module

import { type File } from 'node:stream/consumers';

export type ImageDimensions = {
  width: number;
  height: number;
};

export type UploadImageResult = {
  path: string;
  width: number;
  height: number;
};

export type UploadImagesResult = {
  posterPath: string | null;
  posterWidth: number | null;
  posterHeight: number | null;
  bannerPath: string | null;
  bannerWidth: number | null;
  bannerHeight: number | null;
};

/** Upload a single image file to the persistent server disk. */
export async function uploadImage(_file: File): Promise<UploadImageResult>;

/** Upload multiple image files (poster and banner). */
export async function uploadImages(
  _posterFile: File | null,
  _bannerFile: File | null
): Promise<UploadImagesResult>;

