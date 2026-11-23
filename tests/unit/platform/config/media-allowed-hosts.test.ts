import { describe, expect, it } from 'vitest';

import { parseServerConfig } from '@/platform/config/schema';

/**
 * Trusted media hosts.
 *
 * `MEDIA_ALLOWED_HOSTS` is optional. An unset or empty value means "the
 * operator has not pinned the media hosts", and the shipped `.env.example`
 * sets the variable to an empty value — so an empty value has to be accepted.
 * A configuration file that the project itself ships must never stop the
 * application from starting.
 */
describe('MEDIA_ALLOWED_HOSTS', () => {
  it('accepts an empty value as "no media host is pinned"', () => {
    const config = parseServerConfig({ NODE_ENV: 'development', MEDIA_ALLOWED_HOSTS: '' });

    expect(config.allowedMediaOrigins).toEqual([]);
  });

  it('accepts a whitespace-only value as "no media host is pinned"', () => {
    const config = parseServerConfig({ NODE_ENV: 'development', MEDIA_ALLOWED_HOSTS: '   ' });

    expect(config.allowedMediaOrigins).toEqual([]);
  });

  it('accepts an unset value as "no media host is pinned"', () => {
    const config = parseServerConfig({ NODE_ENV: 'development' });

    expect(config.allowedMediaOrigins).toEqual([]);
  });

  it('keeps the configured HTTPS origins', () => {
    const config = parseServerConfig({
      NODE_ENV: 'development',
      MEDIA_ALLOWED_HOSTS: 'https://media.example.com, https://subs.example.com',
    });

    expect(config.allowedMediaOrigins).toEqual([
      'https://media.example.com',
      'https://subs.example.com',
    ]);
  });

  it('rejects a plain HTTP origin', () => {
    expect(() =>
      parseServerConfig({
        NODE_ENV: 'development',
        MEDIA_ALLOWED_HOSTS: 'http://media.example.com',
      })
    ).toThrow();
  });

  it('rejects an origin that carries credentials', () => {
    expect(() =>
      parseServerConfig({
        NODE_ENV: 'development',
        MEDIA_ALLOWED_HOSTS: 'https://user:secret@media.example.com',
      })
    ).toThrow();
  });

  it('rejects an origin that carries a path', () => {
    expect(() =>
      parseServerConfig({
        NODE_ENV: 'development',
        MEDIA_ALLOWED_HOSTS: 'https://media.example.com/videos',
      })
    ).toThrow();
  });
});
