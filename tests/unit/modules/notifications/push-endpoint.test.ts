import { describe, expect, it } from 'vitest';

import {
  createPinnedLookup,
  isBlockedIpAddress,
  validatePushEndpoint,
} from '@/modules/notifications/push-transport';

/**
 * The browser push endpoint rules (D-070).
 *
 * The endpoint is an address the server will contact on a viewer's behalf, so
 * these rules are the platform's protection against a viewer pointing the
 * server at a host only the server can reach.
 */

describe('validatePushEndpoint', () => {
  it('accepts a public HTTPS endpoint', () => {
    const result = validatePushEndpoint('https://fcm.googleapis.com/fcm/send/abc123');

    expect(result.valid).toBe(true);
  });

  it('refuses an endpoint that is not HTTPS', () => {
    const result = validatePushEndpoint('http://fcm.googleapis.com/fcm/send/abc123');

    expect(result.valid).toBe(false);
  });

  it('refuses an endpoint that carries credentials', () => {
    const result = validatePushEndpoint('https://user:secret@fcm.googleapis.com/send');

    expect(result.valid).toBe(false);
  });

  it('refuses an endpoint that carries a fragment', () => {
    const result = validatePushEndpoint('https://fcm.googleapis.com/send#token');

    expect(result.valid).toBe(false);
  });

  it('refuses an endpoint that is not a URL', () => {
    expect(validatePushEndpoint('not-a-url').valid).toBe(false);
    expect(validatePushEndpoint('').valid).toBe(false);
  });

  it('refuses a local or private host name', () => {
    expect(validatePushEndpoint('https://localhost/send').valid).toBe(false);
    expect(validatePushEndpoint('https://push.localhost/send').valid).toBe(false);
    expect(validatePushEndpoint('https://db.internal/send').valid).toBe(false);
    expect(validatePushEndpoint('https://printer.local/send').valid).toBe(false);
    expect(validatePushEndpoint('https://metadata.google.internal/computeMetadata').valid).toBe(
      false
    );
  });

  it('refuses a private or reserved address literal', () => {
    expect(validatePushEndpoint('https://127.0.0.1/send').valid).toBe(false);
    expect(validatePushEndpoint('https://10.1.2.3/send').valid).toBe(false);
    expect(validatePushEndpoint('https://192.168.0.5/send').valid).toBe(false);
    expect(validatePushEndpoint('https://172.16.0.5/send').valid).toBe(false);
    expect(validatePushEndpoint('https://169.254.169.254/latest/meta-data').valid).toBe(false);
    expect(validatePushEndpoint('https://[::1]/send').valid).toBe(false);
    expect(validatePushEndpoint('https://[fc00::1]/send').valid).toBe(false);
    expect(validatePushEndpoint('https://[fe80::1]/send').valid).toBe(false);
  });

  it('accepts a public address literal', () => {
    expect(validatePushEndpoint('https://142.250.185.78/send').valid).toBe(true);
  });

  it('refuses a host that is not on the operator allowlist', () => {
    const result = validatePushEndpoint('https://push.example.com/send', [
      'fcm.googleapis.com',
    ]);

    expect(result.valid).toBe(false);
  });

  it('accepts an allowlisted host and its subdomains', () => {
    expect(
      validatePushEndpoint('https://fcm.googleapis.com/send', ['fcm.googleapis.com']).valid
    ).toBe(true);
    expect(
      validatePushEndpoint('https://updates.push.services.mozilla.com/send', [
        'fcm.googleapis.com',
        'updates.push.services.mozilla.com',
      ]).valid
    ).toBe(true);
  });
});

describe('isBlockedIpAddress', () => {
  it('blocks the private, loopback, link-local, and reserved ranges', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1',
      '192.0.2.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it('blocks the IPv6 ranges that are not reachable from the internet', () => {
    for (const address of [
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '2002:7f00:0001::1',
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it('blocks the reserved IPv6 ranges of the IANA registry', () => {
    // D-070 refuses a private or reserved IP literal, IPv4 and IPv6 alike. The
    // IANA special-purpose address registry names the IPv6 ranges that are
    // reserved for a protocol, a documentation purpose, or a local mechanism:
    // none of them can be a push endpoint.
    for (const address of [
      '64:ff9b:1::1', // 64:ff9b:1::/48 — local-use NAT64
      '100::1', // 100::/64 — discard-only
      '2001::1', // 2001::/23 — IETF protocol assignments
      '2001:2::1', // 2001:2::/48 — benchmarking
      '2001:20::1', // 2001:20::/28 — ORCHIDv2
      '2001:30::1', // 2001:30::/28 — drone remote ID entity tags
      '3fff::1', // 3fff::/20 — documentation
      '5f00::1', // 5f00::/16 — segment routing
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it('still allows the public IPv6 ranges', () => {
    for (const address of [
      '2001:4860:4860::8888',
      '2001:500::1',
      '2400:cb00::1',
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(false);
    }
  });

  it('allows the public ranges', () => {
    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '142.250.185.78',
      '172.32.0.1',
      '2606:4700:4700::1111',
      '::ffff:8.8.8.8',
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(false);
    }
  });

  it('refuses an address it cannot parse', () => {
    expect(isBlockedIpAddress('not-an-address')).toBe(true);
    expect(isBlockedIpAddress('999.1.1.1')).toBe(true);
  });
});

describe('createPinnedLookup', () => {
  it('answers only with the addresses it was given', () => {
    const lookup = createPinnedLookup([{ address: '93.184.216.34', family: 4 }]);
    const answers: unknown[] = [];

    lookup(
      'push.example.com',
      { all: false },
      (_error, address, family) => {
        answers.push(address, family);
      }
    );

    expect(answers).toEqual(['93.184.216.34', 4]);
  });

  it('answers with every address when the caller asks for all of them', () => {
    const lookup = createPinnedLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::', family: 6 },
    ]);
    const answers: unknown[] = [];

    lookup(
      'push.example.com',
      { all: true },
      (_error, addresses) => {
        answers.push(addresses);
      }
    );

    expect(answers).toEqual([
      [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1::', family: 6 },
      ],
    ]);
  });
});
