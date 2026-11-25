import { describe, expect, it } from 'vitest';

import { parseServerConfig } from '@/platform/config/schema';

/**
 * The browser push configuration (D-070).
 *
 * The deployment reads the VAPID key pair, the contact address, and the host
 * allowlist from the environment, and the configuration is validated once, at
 * startup, so a half-configured deployment fails loudly instead of accepting
 * subscriptions it can never deliver to.
 */

function config(overrides: Record<string, string | undefined> = {}) {
  return parseServerConfig({ NODE_ENV: 'development', ...overrides });
}

describe('the push configuration', () => {
  it('reports an absent key pair as absent', () => {
    const parsed = config();

    expect(parsed.webPushPublicKey).toBeNull();
    expect(parsed.webPushPrivateKey).toBeNull();
    expect(parsed.webPushSubject).toBeNull();
    expect(parsed.webPushTtlSeconds).toBe(3600);
    expect(parsed.pushAllowedHosts).toEqual([]);
  });

  it('keeps a complete key pair', () => {
    const parsed = config({
      WEB_PUSH_PUBLIC_KEY: 'public-key',
      WEB_PUSH_PRIVATE_KEY: 'private-key',
      WEB_PUSH_SUBJECT: 'mailto:ops@dramascan.local',
      WEB_PUSH_TTL_SECONDS: '120',
      PUSH_ALLOWED_HOSTS: 'fcm.googleapis.com, updates.push.services.mozilla.com',
    });

    expect(parsed.webPushPublicKey).toBe('public-key');
    expect(parsed.webPushPrivateKey).toBe('private-key');
    expect(parsed.webPushSubject).toBe('mailto:ops@dramascan.local');
    expect(parsed.webPushTtlSeconds).toBe(120);
    expect(parsed.pushAllowedHosts).toEqual([
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
    ]);
  });

  it('refuses a half-configured key pair', () => {
    expect(() => config({ WEB_PUSH_PUBLIC_KEY: 'public-key' })).toThrow(
      /WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY must be set together/
    );
    expect(() => config({ WEB_PUSH_PRIVATE_KEY: 'private-key' })).toThrow(
      /WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY must be set together/
    );
  });

  it('refuses a contact address that is neither a mailto nor an HTTPS URL', () => {
    expect(() => config({ WEB_PUSH_SUBJECT: 'ops@dramascan.local' })).toThrow(
      /WEB_PUSH_SUBJECT must be a mailto: address or an HTTPS URL/
    );
    expect(() => config({ WEB_PUSH_SUBJECT: 'http://ops.dramascan.local' })).toThrow(
      /WEB_PUSH_SUBJECT must be a mailto: address or an HTTPS URL/
    );
  });

  it('accepts an HTTPS contact address', () => {
    expect(config({ WEB_PUSH_SUBJECT: 'https://dramascan.local/contact' }).webPushSubject).toBe(
      'https://dramascan.local/contact'
    );
  });

  it('refuses a message lifetime the push service would not accept', () => {
    expect(() => config({ WEB_PUSH_TTL_SECONDS: '-1' })).toThrow();
    expect(() => config({ WEB_PUSH_TTL_SECONDS: '2419201' })).toThrow();
  });

  it('refuses an allowlist entry that is not a host name', () => {
    expect(() => config({ PUSH_ALLOWED_HOSTS: 'https://fcm.googleapis.com' })).toThrow(
      /PUSH_ALLOWED_HOSTS contains an invalid host/
    );
    expect(() => config({ PUSH_ALLOWED_HOSTS: 'fcm.googleapis.com/path' })).toThrow(
      /PUSH_ALLOWED_HOSTS contains an invalid host/
    );
  });

  it('treats an empty allowlist as "any public host"', () => {
    expect(config({ PUSH_ALLOWED_HOSTS: '' }).pushAllowedHosts).toEqual([]);
    expect(config({ PUSH_ALLOWED_HOSTS: '   ' }).pushAllowedHosts).toEqual([]);
  });
});
