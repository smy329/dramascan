/**
 * The browser push transport (D-070).
 *
 * The transport is the part of the platform that talks to a push service. It
 * is deliberately kept in one file, with no application import and no
 * `server-only` marker, for two reasons:
 *
 *   - The application imports it through `push-provider.ts`, which owns the
 *     deployment configuration.
 *   - The short-lived maintenance command (`scripts/notification-maintenance.mjs`)
 *     imports it directly, so the command and the application share exactly
 *     one implementation of the transport and of the endpoint rules.
 *
 * The endpoint is a capability: whoever holds it can receive that viewer's
 * push messages. A viewer therefore chooses it, and the server validates it
 * before it is stored and again before every delivery. The validation is the
 * platform's protection against a viewer pointing the server at an address
 * that only the server can reach (a server-side request forgery):
 *
 *   - The endpoint must be an HTTPS URL without credentials and without a
 *     fragment.
 *   - The host must not be a local, private, link-local, or otherwise
 *     reserved name, and an address literal must not be a private address.
 *   - The operator may pin the accepted hosts with `PUSH_ALLOWED_HOSTS`.
 *   - Before a delivery, the host is resolved and every address it resolves to
 *     must be a public address; the connection is then pinned to those
 *     addresses, so a name that changes its answer between the check and the
 *     request cannot redirect the request.
 *
 * The module runs on the server only: it uses Node's DNS resolver and the
 * Node HTTPS agent. It must never be imported from a Client Component.
 */

/** The configuration one transport needs. */
export type PushTransportConfig = {
  /** The VAPID public key. */
  publicKey: string | null;
  /** The VAPID private key. It never leaves the server. */
  privateKey: string | null;
  /** The contact address the push service shows the viewer. */
  subject: string;
  /** How long the push service may hold an undelivered message, in seconds. */
  ttlSeconds: number;
  /** The hosts a push endpoint may point at. Empty means "any public host". */
  allowedHosts: readonly string[];
  /** The socket timeout of one delivery, in milliseconds. */
  timeoutMs: number;
};

/** The default lifetime of a queued push message: one hour. */
export const DEFAULT_PUSH_TTL_SECONDS = 3600;

/** The longest lifetime a push service accepts: four weeks. */
export const MAX_PUSH_TTL_SECONDS = 2_419_200;

/** The default socket timeout of one delivery: ten seconds. */
export const DEFAULT_PUSH_TIMEOUT_MS = 10_000;

/** One resolved address of a push host. */
export type ResolvedAddress = {
  /** The address itself. */
  address: string;
  /** The address family: 4 for IPv4, 6 for IPv6. */
  family: number;
};

/** The outcome of validating a push endpoint. */
export type PushEndpointValidation =
  | { readonly valid: true; readonly url: URL }
  | { readonly valid: false; readonly reason: string };

/** The subscription one delivery addresses. */
export type PushTransportSubscription = {
  /** The provider's endpoint URL. */
  endpoint: string;
  /** The client's public key, in base64url. */
  p256dh: string | null;
  /** The client's authentication secret, in base64url. */
  auth: string | null;
};

/** The message one delivery carries. */
export type PushTransportMessage = {
  /** The notification title. */
  title: string;
  /** The notification body. */
  body: string;
  /** A deep link into the site. */
  link?: string | null;
  /** An identifier the provider uses to collapse duplicates. */
  collapseKey?: string | null;
};

/** The outcome of one delivery attempt. */
export type PushTransportResult = {
  /** Whether the provider accepted the message. */
  delivered: boolean;
  /**
   * Whether the subscription is permanently unusable.
   *
   * A `410 Gone` or a `404 Not Found` means the endpoint is gone: the
   * subscription must be removed, and the message must not be retried.
   */
  expired: boolean;
  /** A short, credential-free description of what happened. */
  error: string | null;
};

/**
 * Validate a browser push endpoint.
 *
 * The check is deliberately strict: a push endpoint is a URL the server will
 * later contact, so anything that is not plainly a public HTTPS endpoint is
 * refused rather than repaired.
 *
 * @param endpoint the endpoint the browser handed over
 * @param allowedHosts the operator's host allowlist; empty accepts any public host
 * @returns the validation outcome
 */
export function validatePushEndpoint(
  endpoint: string,
  allowedHosts: readonly string[] = []
): PushEndpointValidation {
  const trimmed = endpoint.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: 'The push endpoint is empty.' };
  }

  if (trimmed.length > 2048) {
    return { valid: false, reason: 'The push endpoint is too long.' };
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'The push endpoint is not a valid URL.' };
  }

  if (url.protocol !== 'https:') {
    return { valid: false, reason: 'The push endpoint must use HTTPS.' };
  }

  if (url.username !== '' || url.password !== '') {
    return { valid: false, reason: 'The push endpoint must not contain credentials.' };
  }

  if (url.hash !== '') {
    return { valid: false, reason: 'The push endpoint must not contain a fragment.' };
  }

  const hostname = normalizeHostname(url.hostname);

  if (hostname.length === 0) {
    return { valid: false, reason: 'The push endpoint must contain a host.' };
  }

  if (isPrivateHostname(hostname)) {
    return {
      valid: false,
      reason: 'The push endpoint must not point at a local or private host.',
    };
  }

  if (isIpLiteral(hostname) && isBlockedIpAddress(hostname)) {
    return {
      valid: false,
      reason: 'The push endpoint must not point at a private or reserved address.',
    };
  }

  if (allowedHosts.length > 0 && !matchesAllowedHost(hostname, allowedHosts)) {
    return {
      valid: false,
      reason: 'The push endpoint host is not on the operator’s allowlist.',
    };
  }

  return { valid: true, url };
}

/**
 * Is this host name one the server must never contact?
 *
 * The names are refused before any address is resolved: a name that means
 * "this machine" or "this network" has no place in a push endpoint.
 *
 * @param hostname the host name, already normalized
 * @returns whether the name is local or private
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    return true;
  }

  // A name with an empty label is malformed and resolves nowhere useful.
  return host.includes('..');
}

/**
 * Is this address one the server must never contact?
 *
 * The list covers the ranges that are not reachable from the public
 * internet: the private networks, the loopback, the link-local addresses
 * (including the cloud metadata address), the carrier-grade NAT range, the
 * multicast and reserved ranges, and the address forms that embed an IPv4
 * address inside an IPv6 one.
 *
 * @param address the address, in its textual form
 * @returns whether the address is private, local, or reserved
 */
export function isBlockedIpAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);

  if (ipv4) {
    return isBlockedIpv4(ipv4);
  }

  const ipv6 = parseIpv6(address);

  if (!ipv6) {
    // An address that cannot be parsed is not an address the platform can
    // reason about, so it is refused.
    return true;
  }

  return isBlockedIpv6(ipv6);
}

/**
 * Resolve a push host and check every address it resolves to.
 *
 * A host that resolves to a private address is refused: the name may be
 * public while its answer is not, and the answer is what the server would
 * connect to.
 *
 * @param hostname the host name
 * @returns the resolved addresses, or `null` when the host cannot be used
 */
export async function resolvePublicAddresses(
  hostname: string
): Promise<ResolvedAddress[] | null> {
  if (isIpLiteral(hostname)) {
    return isBlockedIpAddress(hostname)
      ? null
      : [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }];
  }

  let addresses: ResolvedAddress[];

  try {
    const { lookup } = await import('node:dns/promises');
    const resolved = await lookup(hostname, { all: true, verbatim: true });

    addresses = resolved.map(entry => ({ address: entry.address, family: entry.family }));
  } catch {
    return null;
  }

  if (addresses.length === 0) {
    return null;
  }

  for (const entry of addresses) {
    if (isBlockedIpAddress(entry.address)) {
      return null;
    }
  }

  return addresses;
}

/**
 * Build a DNS lookup that only ever answers with the given addresses.
 *
 * The agent uses it for the connection, so a name that changes its answer
 * between the check and the request cannot redirect the request to an address
 * the check never saw.
 *
 * @param addresses the addresses the host resolved to
 * @returns a lookup function for the Node HTTPS agent
 */
export function createPinnedLookup(
  addresses: readonly ResolvedAddress[]
): (
  _hostname: string,
  _options: { all?: boolean; family?: number; hints?: number },
  _callback: (
    _error: NodeJS.ErrnoException | null,
    _address?: string | ResolvedAddress[],
    _family?: number
  ) => void
) => void {
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(
        null,
        addresses.map(entry => ({ address: entry.address, family: entry.family }))
      );
      return;
    }

    const first = addresses[0];

    if (!first) {
      callback(new Error('The push host has no usable address.'));
      return;
    }

    callback(null, first.address, first.family);
  };
}

/**
 * Deliver one message to one subscription.
 *
 * The endpoint is validated again here: the stored row may predate the
 * validation rule, and a delivery is the moment the server actually contacts
 * the address.
 *
 * @param subscription the subscription to deliver to
 * @param message the message
 * @param config the transport configuration
 * @returns what the attempt did
 */
export async function sendWebPush(
  subscription: PushTransportSubscription,
  message: PushTransportMessage,
  config: PushTransportConfig
): Promise<PushTransportResult> {
  if (config.publicKey === null || config.privateKey === null) {
    return {
      delivered: false,
      expired: false,
      error: 'Browser push is not configured.',
    };
  }

  if (subscription.p256dh === null || subscription.auth === null) {
    return {
      delivered: false,
      expired: false,
      error: 'The stored subscription has no encryption keys.',
    };
  }

  const validation = validatePushEndpoint(subscription.endpoint, config.allowedHosts);

  if (!validation.valid) {
    return {
      delivered: false,
      expired: false,
      // The reason is not stored: it describes the operator's policy, and the
      // delivery record is read by administrators.
      error: 'The push endpoint was refused.',
    };
  }

  const hostname = normalizeHostname(validation.url.hostname);
  const addresses = await resolvePublicAddresses(hostname);

  if (!addresses) {
    return {
      delivered: false,
      expired: false,
      error: 'The push endpoint was refused.',
    };
  }

  try {
    const webpush = await import('web-push');
    const https = await import('node:https');

    const agent = new https.Agent({
      lookup: createPinnedLookup(addresses) as never,
    });

    await webpush.sendNotification(
      {
        endpoint: validation.url.toString(),
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: message.title,
        body: message.body,
        link: message.link ?? null,
        collapseKey: message.collapseKey ?? null,
      }),
      {
        TTL: config.ttlSeconds,
        urgency: 'normal',
        timeout: config.timeoutMs,
        agent,
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
      }
    );

    return { delivered: true, expired: false, error: null };
  } catch (error) {
    const statusCode = readStatusCode(error);

    if (statusCode === 404 || statusCode === 410) {
      return {
        delivered: false,
        expired: true,
        error: `The push subscription is gone (HTTP ${statusCode}).`,
      };
    }

    return {
      delivered: false,
      expired: false,
      // The underlying message may embed the endpoint, which is a capability.
      // Only the status code is safe to store.
      error:
        statusCode === null
          ? 'The push service could not be reached.'
          : `The push service rejected the message (HTTP ${statusCode}).`,
    };
  }
}

/** Read an HTTP status code from a provider error without trusting its message. */
function readStatusCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;

    if (typeof statusCode === 'number') {
      return statusCode;
    }
  }

  return null;
}

/** The host of a URL, without the brackets an IPv6 literal carries. */
function normalizeHostname(hostname: string): string {
  const host = hostname.trim().toLowerCase();

  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }

  return host;
}

/** Does the host match the operator's allowlist? */
function matchesAllowedHost(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();

  return allowedHosts.some(allowed => {
    const entry = allowed.trim().toLowerCase();

    if (entry.length === 0) {
      return false;
    }

    return host === entry || host.endsWith(`.${entry}`);
  });
}

/** Is this host an address literal rather than a name? */
function isIpLiteral(hostname: string): boolean {
  return parseIpv4(hostname) !== null || parseIpv6(hostname) !== null;
}

/** Parse a dotted-quad IPv4 address into its four octets. */
function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split('.');

  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const value = Number(part);

    if (value < 0 || value > 255) {
      return null;
    }

    octets.push(value);
  }

  return [octets[0] as number, octets[1] as number, octets[2] as number, octets[3] as number];
}

/** Is this IPv4 address private, local, or reserved? */
function isBlockedIpv4(octets: readonly [number, number, number, number]): boolean {
  const [first, second] = octets;

  if (first === 0) {
    // 0.0.0.0/8 — "this network".
    return true;
  }

  if (first === 10) {
    // 10.0.0.0/8 — private.
    return true;
  }

  if (first === 100 && second >= 64 && second <= 127) {
    // 100.64.0.0/10 — carrier-grade NAT.
    return true;
  }

  if (first === 127) {
    // 127.0.0.0/8 — loopback.
    return true;
  }

  if (first === 169 && second === 254) {
    // 169.254.0.0/16 — link-local, including the cloud metadata address.
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    // 172.16.0.0/12 — private.
    return true;
  }

  if (first === 192 && second === 168) {
    // 192.168.0.0/16 — private.
    return true;
  }

  if (first === 192 && second === 0 && (octets[2] === 0 || octets[2] === 2)) {
    // 192.0.0.0/24 and 192.0.2.0/24 — protocol assignments and documentation.
    return true;
  }

  if (first === 192 && second === 88 && octets[2] === 99) {
    // 192.88.99.0/24 — the deprecated 6to4 relay anycast.
    return true;
  }

  if (first === 198 && (second === 18 || second === 19)) {
    // 198.18.0.0/15 — benchmarking.
    return true;
  }

  if (first === 198 && second === 51 && octets[2] === 100) {
    // 198.51.100.0/24 — documentation.
    return true;
  }

  if (first === 203 && second === 0 && octets[2] === 113) {
    // 203.0.113.0/24 — documentation.
    return true;
  }

  if (first >= 224) {
    // 224.0.0.0/4 — multicast, and 240.0.0.0/4 — reserved.
    return true;
  }

  return false;
}

/** Parse an IPv6 address into its eight 16-bit groups. */
function parseIpv6(address: string): number[] | null {
  let value = address.trim().toLowerCase();
  const zone = value.indexOf('%');

  if (zone !== -1) {
    value = value.slice(0, zone);
  }

  if (!value.includes(':')) {
    return null;
  }

  // An IPv4 tail (::ffff:127.0.0.1) becomes two 16-bit groups.
  const lastColon = value.lastIndexOf(':');
  const tail = value.slice(lastColon + 1);

  if (tail.includes('.')) {
    const octets = parseIpv4(tail);

    if (!octets) {
      return null;
    }

    const high = (octets[0] << 8 | octets[1]).toString(16);
    const low = (octets[2] << 8 | octets[3]).toString(16);

    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = value.split('::');

  if (halves.length > 2) {
    return null;
  }

  const headSource = halves[0] ?? '';
  const rearSource = halves[1] ?? '';
  const head = headSource === '' ? [] : headSource.split(':');
  const rear = halves.length === 2 && rearSource !== '' ? rearSource.split(':') : [];

  if (halves.length === 1 && head.length !== 8) {
    return null;
  }

  const missing = 8 - head.length - rear.length;

  if (missing < 0) {
    return null;
  }

  const groups = [...head, ...new Array<string>(missing).fill('0'), ...rear];

  if (groups.length !== 8) {
    return null;
  }

  const parsed: number[] = [];

  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }

    parsed.push(Number.parseInt(group, 16));
  }

  return parsed;
}

/** Is this IPv6 address private, local, or reserved? */
function isBlockedIpv6(groups: readonly number[]): boolean {
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  const third = groups[2] ?? 0;
  const fourth = groups[3] ?? 0;
  const fifth = groups[4] ?? 0;
  const sixth = groups[5] ?? 0;
  const seventh = groups[6] ?? 0;
  const eighth = groups[7] ?? 0;

  if (groups.every(group => group === 0)) {
    // :: — unspecified.
    return true;
  }

  if (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && sixth === 0 && seventh === 0 && eighth === 1) {
    // ::1 — loopback.
    return true;
  }

  if ((first & 0xfe00) === 0xfc00) {
    // fc00::/7 — unique local.
    return true;
  }

  if ((first & 0xffc0) === 0xfe80) {
    // fe80::/10 — link-local.
    return true;
  }

  if ((first & 0xffc0) === 0xfec0) {
    // fec0::/10 — the deprecated site-local range.
    return true;
  }

  if ((first & 0xff00) === 0xff00) {
    // ff00::/8 — multicast.
    return true;
  }

  // The address forms that embed an IPv4 address are judged by that address.
  if (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && sixth === 0xffff) {
    // ::ffff:0:0/96 — IPv4-mapped.
    return isBlockedIpv4(embeddedIpv4(seventh, eighth));
  }

  if (
    first === 0x0064 &&
    second === 0xff9b &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0
  ) {
    // 64:ff9b::/96 — NAT64.
    return isBlockedIpv4(embeddedIpv4(seventh, eighth));
  }

  if (first === 0x2002) {
    // 2002::/16 — 6to4, which carries the IPv4 address in the next 32 bits.
    return isBlockedIpv4(embeddedIpv4(second, third));
  }

  if (first === 0x2001 && second === 0x0db8) {
    // 2001:db8::/32 — documentation.
    return true;
  }

  return false;
}

/** The IPv4 address two 16-bit groups carry. */
function embeddedIpv4(high: number, low: number): [number, number, number, number] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}
