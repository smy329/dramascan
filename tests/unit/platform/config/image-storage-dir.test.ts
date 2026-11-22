import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IMAGE_STORAGE_DIR,
  parseServerConfig,
  resolveImageStorageDir,
} from '@/platform/config/schema';

/**
 * Image storage location.
 *
 * Uploaded artwork has to survive a deployment that replaces the release
 * directory, so the default location is environment-aware: a production Linux
 * deployment uses the systemd state directory, while a development machine
 * keeps the files beside the project.
 */
describe('resolveImageStorageDir', () => {
  it('keeps a configured absolute directory', () => {
    expect(resolveImageStorageDir('/srv/dramascan/artwork', { platform: 'linux' })).toBe(
      path.resolve('/srv/dramascan/artwork')
    );
  });

  it('resolves a configured relative directory against the working directory', () => {
    expect(resolveImageStorageDir('artwork/images', { platform: 'linux' })).toBe(
      path.resolve(process.cwd(), 'artwork/images')
    );
  });

  it('uses the persistent state directory by default in production on Linux', () => {
    const resolved = resolveImageStorageDir(undefined, { platform: 'linux', production: true });

    expect(resolved).toBe(DEFAULT_IMAGE_STORAGE_DIR);
    expect(path.posix.isAbsolute(resolved)).toBe(true);
  });

  it('keeps the default outside the release directory in production on Linux', () => {
    const resolved = resolveImageStorageDir(undefined, { platform: 'linux', production: true });

    expect(resolved.startsWith(`${path.resolve(process.cwd())}${path.sep}`)).toBe(false);
  });

  it('keeps the files beside the project outside production', () => {
    expect(resolveImageStorageDir(undefined, { platform: 'linux', production: false })).toBe(
      path.resolve(process.cwd(), 'storage', 'images')
    );
  });

  it('keeps the files beside the project on a development platform', () => {
    expect(resolveImageStorageDir(undefined, { platform: 'win32', production: true })).toBe(
      path.resolve(process.cwd(), 'storage', 'images')
    );
  });

  it('ignores an empty configured value', () => {
    expect(resolveImageStorageDir('   ', { platform: 'win32', production: false })).toBe(
      path.resolve(process.cwd(), 'storage', 'images')
    );
  });
});

describe('IMAGE_STORAGE_DIR validation', () => {
  const production = {
    NODE_ENV: 'production',
    APP_URL: 'https://dramascan.example',
    DATABASE_URL: 'postgresql://dramascan_app:dummy-secret@localhost:5432/dramascan',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    GOOGLE_CLIENT_ID: 'client-id-value',
    GOOGLE_CLIENT_SECRET: 'dummy-secret',
    SUPER_ADMIN_EMAIL: 'admin@example.com',
  };

  it('rejects a directory inside the application directory in production', () => {
    expect(() =>
      parseServerConfig({ ...production, IMAGE_STORAGE_DIR: 'storage/images' })
    ).toThrow(/IMAGE_STORAGE_DIR/);
  });

  it('rejects a directory inside the build output', () => {
    expect(() =>
      parseServerConfig({ ...production, IMAGE_STORAGE_DIR: '.next/images' })
    ).toThrow(/IMAGE_STORAGE_DIR/);
  });

  it('accepts a persistent directory outside the application directory', () => {
    const config = parseServerConfig({
      ...production,
      IMAGE_STORAGE_DIR: '/var/lib/dramascan/images',
    });

    expect(config.imageStorageDir).toBe(path.resolve('/var/lib/dramascan/images'));
  });

  it('allows a directory beside the project outside production', () => {
    const config = parseServerConfig({
      NODE_ENV: 'development',
      IMAGE_STORAGE_DIR: 'storage/images',
    });

    expect(config.imageStorageDir).toBe(path.resolve(process.cwd(), 'storage', 'images'));
  });
});
