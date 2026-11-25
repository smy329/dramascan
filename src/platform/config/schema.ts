import { z } from 'zod';
import path from 'node:path';

export type Environment = 'development' | 'test' | 'production';

export type ServerConfig = Readonly<{
  nodeEnv: Environment;
  isProduction: boolean;
  appUrl: string;
  trustedOrigins: readonly string[];
  databaseUrl: string | null;
  testDatabaseUrl: string | null;
  betterAuthSecret: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  superAdminEmail: string | null;
  logLevel?: string | null;
  adminSessionInactivityTimeout?: number;
  adminSessionMaxLifetime?: number;
  /** Absolute directory that stores original poster and banner files. */
  imageStorageDir: string;
  /** Global rule for published dramas that have no playable episode. */
  emptyDramaVisibility: EmptyDramaVisibility;
  /** Default Trash retention period in days. */
  trashRetentionDays: number;
  /**
   * External origins the browser may load video and subtitle files from.
   *
   * Empty means "any HTTPS origin": the operator has not pinned the media
   * hosts yet. A non-empty list restricts the browser to exactly those
   * origins.
   */
  allowedMediaOrigins: readonly string[];
  /**
   * Percentage of an episode that counts as watched.
   *
   * One value, used by the server when it decides whether an episode is
   * watched and handed to the player, so the client and the server never apply
   * divergent rules (requirements §7.3).
   */
  playbackCompletionThresholdPercent: number;
  /** The VAPID public key the browser needs to create a subscription. */
  webPushPublicKey: string | null;
  /** The VAPID private key. It never leaves the server. */
  webPushPrivateKey: string | null;
  /** The contact address the push service shows the viewer. */
  webPushSubject: string | null;
  /** How long the push service may hold an undelivered message, in seconds. */
  webPushTtlSeconds: number;
  /**
   * The hosts a browser push endpoint may point at.
   *
   * Empty means "any public HTTPS host". A non-empty list pins the deployment
   * to the push services it trusts, so a viewer cannot point the server at an
   * address of their choosing (D-070).
   */
  pushAllowedHosts: readonly string[];
  /** The Firebase Cloud Messaging server key. The adapter is retained, not selected. */
  fcmServerKey: string | null;
  /** The Firebase Cloud Messaging project id. The adapter is retained, not selected. */
  fcmProjectId: string | null;
}>;

/** Global empty-drama visibility modes (requirements §4.7). */
export const EMPTY_DRAMA_VISIBILITY_MODES = ['coming_soon', 'hidden'] as const;

export type EmptyDramaVisibility = (typeof EMPTY_DRAMA_VISIBILITY_MODES)[number];

/** Default Trash retention period in days (requirements §4.8). */
export const DEFAULT_TRASH_RETENTION_DAYS = 30;

/** Default playback completion threshold in percent (requirements §7.3). */
export const DEFAULT_PLAYBACK_COMPLETION_THRESHOLD_PERCENT = 90;

/** Default lifetime of a queued browser push message, in seconds. */
export const DEFAULT_PUSH_TTL_SECONDS = 3600;

/** The longest lifetime a push service accepts, in seconds (four weeks). */
export const MAX_PUSH_TTL_SECONDS = 2_419_200;

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join('\n'));
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
};

const httpUrlSchema = z.url({ protocol: /^https?$/ });
const postgresUrlSchema = z.url({ protocol: /^postgres(ql)?$/ }).superRefine((value, ctx) => {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'PostgreSQL connection strings must be valid URLs.',
    });
    return;
  }

  if (parsed.hostname.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'PostgreSQL connection strings must include a hostname.',
    });
    return;
  }

  if (databaseNameFromConnectionString(parsed).length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'PostgreSQL connection strings must include a database name.',
    });
    return;
  }

  if (parsed.hash !== '') {
    ctx.addIssue({
      code: 'custom',
      message: 'PostgreSQL connection strings must not include a fragment.',
    });
    return;
  }
});
const emailSchema = z.email().transform(value => value.toLowerCase());

const rawServerConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    APP_URL: httpUrlSchema.optional(),
    TRUSTED_ORIGINS: z.string().optional(),
    DATABASE_URL: postgresUrlSchema.optional(),
    TEST_DATABASE_URL: postgresUrlSchema.optional(),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must contain at least 32 characters.')
      .optional(),
    GOOGLE_CLIENT_ID: z.string().min(10, 'GOOGLE_CLIENT_ID is too short.').optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(10, 'GOOGLE_CLIENT_SECRET is too short.').optional(),
    SUPER_ADMIN_EMAIL: emailSchema.optional(),
    LOG_LEVEL: z.string().optional(),
    adminSessionInactivityTimeout: z.string().optional(),
    adminSessionMaxLifetime: z.string().optional(),
    IMAGE_STORAGE_DIR: z.string().min(1).optional(),
    EMPTY_DRAMA_VISIBILITY: z.enum(EMPTY_DRAMA_VISIBILITY_MODES).optional(),
    MEDIA_ALLOWED_HOSTS: z.string().optional(),
    PLAYBACK_COMPLETION_THRESHOLD_PERCENT: z.coerce
      .number()
      .int('PLAYBACK_COMPLETION_THRESHOLD_PERCENT must be a whole number.')
      .min(1, 'PLAYBACK_COMPLETION_THRESHOLD_PERCENT must be at least 1.')
      .max(100, 'PLAYBACK_COMPLETION_THRESHOLD_PERCENT must be at most 100.')
      .optional(),
    TRASH_RETENTION_DAYS: z.coerce
      .number()
      .int('TRASH_RETENTION_DAYS must be a whole number.')
      .min(1, 'TRASH_RETENTION_DAYS must be at least 1.')
      .max(365, 'TRASH_RETENTION_DAYS must be at most 365.')
      .optional(),
    WEB_PUSH_PUBLIC_KEY: z.string().min(1).optional(),
    WEB_PUSH_PRIVATE_KEY: z.string().min(1).optional(),
    WEB_PUSH_SUBJECT: z.string().min(1).optional(),
    WEB_PUSH_TTL_SECONDS: z.coerce
      .number()
      .int('WEB_PUSH_TTL_SECONDS must be a whole number.')
      .min(0, 'WEB_PUSH_TTL_SECONDS must not be negative.')
      .max(MAX_PUSH_TTL_SECONDS, 'WEB_PUSH_TTL_SECONDS must be at most 2419200.')
      .optional(),
    PUSH_ALLOWED_HOSTS: z.string().optional(),
    FCM_SERVER_KEY: z.string().min(1).optional(),
    FCM_PROJECT_ID: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const isProduction = value.NODE_ENV === 'production';
    const appUrl = value.APP_URL ?? (isProduction ? undefined : 'http://localhost:3000');

    if (appUrl === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'APP_URL is required in production.',
      });
    } else {
      validateOrigin(appUrl, 'APP_URL', isProduction, ctx);
    }

    if (isProduction) {
      const requiredFields = [
        'DATABASE_URL',
        'BETTER_AUTH_SECRET',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'SUPER_ADMIN_EMAIL',
      ] as const;

      for (const field of requiredFields) {
        if (value[field] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required in production.`,
          });
        }
      }
    }

    validateTrustedOrigins(value.TRUSTED_ORIGINS, isProduction, ctx);
    validateTestDatabase(value.TEST_DATABASE_URL, value.DATABASE_URL, ctx);
    validateImageStorageDir(value.IMAGE_STORAGE_DIR, isProduction, ctx);
    validateAllowedMediaOrigins(value.MEDIA_ALLOWED_HOSTS, ctx);
    validatePushConfiguration(value, ctx);
  })
  .transform(value => toServerConfig(value));

export function parseServerConfig(
  input: Record<string, string | undefined>,
  fallbackNodeEnv: string = 'development'
): ServerConfig {
  const normalizedInput = normalizeInput(input);
  const nodeEnv = normalizedInput.NODE_ENV ?? fallbackNodeEnv;

  const result = rawServerConfigSchema.safeParse({ ...normalizedInput, NODE_ENV: nodeEnv });

  if (!result.success) {
    throw new ConfigurationError(result.error.issues.map(formatIssue));
  }

  return result.data;
}

type RawEnvironment = Readonly<{
  NODE_ENV: Environment;
  APP_URL?: string | undefined;
  TRUSTED_ORIGINS?: string | undefined;
  DATABASE_URL?: string | undefined;
  TEST_DATABASE_URL?: string | undefined;
  BETTER_AUTH_SECRET?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  SUPER_ADMIN_EMAIL?: string | undefined;
  adminSessionInactivityTimeout?: string;
  adminSessionMaxLifetime?: string;
  IMAGE_STORAGE_DIR?: string | undefined;
  EMPTY_DRAMA_VISIBILITY?: EmptyDramaVisibility | undefined;
  MEDIA_ALLOWED_HOSTS?: string | undefined;
  PLAYBACK_COMPLETION_THRESHOLD_PERCENT?: number | undefined;
  TRASH_RETENTION_DAYS?: number | undefined;
  WEB_PUSH_PUBLIC_KEY?: string | undefined;
  WEB_PUSH_PRIVATE_KEY?: string | undefined;
  WEB_PUSH_SUBJECT?: string | undefined;
  WEB_PUSH_TTL_SECONDS?: number | undefined;
  PUSH_ALLOWED_HOSTS?: string | undefined;
  FCM_SERVER_KEY?: string | undefined;
  FCM_PROJECT_ID?: string | undefined;
}>;

function toServerConfig(value: RawEnvironment): ServerConfig {
  const isProduction = value.NODE_ENV === 'production';
  const appUrl = normalizeOrigin(value.APP_URL ?? 'http://localhost:3000');
  const configuredOrigins = splitOrigins(value.TRUSTED_ORIGINS).map(normalizeOrigin);

  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    isProduction,
    appUrl,
    trustedOrigins: Object.freeze([...new Set([appUrl, ...configuredOrigins])]),
    databaseUrl: value.DATABASE_URL ?? null,
    testDatabaseUrl: value.TEST_DATABASE_URL ?? null,
    betterAuthSecret: value.BETTER_AUTH_SECRET ?? null,
    googleClientId: value.GOOGLE_CLIENT_ID ?? null,
    googleClientSecret: value.GOOGLE_CLIENT_SECRET ?? null,
    superAdminEmail: value.SUPER_ADMIN_EMAIL ?? null,
    adminSessionInactivityTimeout: value.adminSessionInactivityTimeout
      ? Math.max(1, Number(value.adminSessionInactivityTimeout))
      : undefined,
    adminSessionMaxLifetime: value.adminSessionMaxLifetime
      ? Math.max(1, Number(value.adminSessionMaxLifetime))
      : undefined,
    imageStorageDir: resolveImageStorageDir(value.IMAGE_STORAGE_DIR, { production: isProduction }),
    emptyDramaVisibility: value.EMPTY_DRAMA_VISIBILITY ?? 'coming_soon',
    trashRetentionDays: value.TRASH_RETENTION_DAYS ?? DEFAULT_TRASH_RETENTION_DAYS,
    allowedMediaOrigins: Object.freeze(
      splitOrigins(value.MEDIA_ALLOWED_HOSTS).map(origin => new URL(origin).origin)
    ),
    playbackCompletionThresholdPercent:
      value.PLAYBACK_COMPLETION_THRESHOLD_PERCENT ??
      DEFAULT_PLAYBACK_COMPLETION_THRESHOLD_PERCENT,
    webPushPublicKey: value.WEB_PUSH_PUBLIC_KEY ?? null,
    webPushPrivateKey: value.WEB_PUSH_PRIVATE_KEY ?? null,
    webPushSubject: value.WEB_PUSH_SUBJECT ?? null,
    webPushTtlSeconds: value.WEB_PUSH_TTL_SECONDS ?? DEFAULT_PUSH_TTL_SECONDS,
    pushAllowedHosts: Object.freeze(
      splitOrigins(value.PUSH_ALLOWED_HOSTS).map(host => host.toLowerCase())
    ),
    fcmServerKey: value.FCM_SERVER_KEY ?? null,
    fcmProjectId: value.FCM_PROJECT_ID ?? null,
  });
}

/**
 * The persistent image directory used by a production Linux deployment.
 *
 * `/var/lib/dramascan` is the systemd state directory of the `dramascan`
 * service (`StateDirectory=dramascan`). It survives a deployment that
 * replaces the release directory, which is where the uploaded artwork has to
 * live.
 */
export const DEFAULT_IMAGE_STORAGE_DIR = '/var/lib/dramascan/images';

/** The development image directory, kept beside the project. */
export const DEVELOPMENT_IMAGE_STORAGE_DIR = path.join('storage', 'images');

/**
 * Resolve the image storage directory to an absolute path.
 *
 * A configured value always wins. Without one, the directory depends on the
 * environment: a production Linux deployment uses the systemd state
 * directory, because the release directory is replaced on every update and
 * would take the uploaded artwork with it. A development machine keeps the
 * files beside the project.
 */
export function resolveImageStorageDir(
  configured?: string | null,
  options: { platform?: NodeJS.Platform; production?: boolean } = {}
): string {
  const value = configured?.trim();
  const platform = options.platform ?? process.platform;
  const production = options.production ?? false;

  if (value && value.length > 0) {
    // The directory is a runtime value on purpose: the deployment configures
    // it through `IMAGE_STORAGE_DIR`, and the application writes to it at
    // runtime rather than reading it from the bundle. The trace hint keeps
    // Turbopack from copying the whole project into the build output for it.
    return path.resolve(/*turbopackIgnore: true*/ process.cwd(), value);
  }

  if (production && platform === 'linux') {
    return DEFAULT_IMAGE_STORAGE_DIR;
  }

  return path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    DEVELOPMENT_IMAGE_STORAGE_DIR
  );
}

function databaseNameFromConnectionString(url: URL): string {
  try {
    return decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

function normalizeInput(input: Record<string, string | undefined>): Record<string, string> {
  const entries = Object.entries(input).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  return Object.fromEntries(entries);
}

function splitOrigins(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

function validateOrigin(
  value: string,
  field: string,
  isProduction: boolean,
  ctx: z.RefinementCtx
): void {
  const parsed = new URL(value);

  if (parsed.username !== '' || parsed.password !== '') {
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message: `${field} must not contain credentials.`,
    });
    return;
  }

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message: `${field} must be an origin without a path, query, or fragment.`,
    });
    return;
  }

  if (parsed.protocol === 'https:') {
    return;
  }

  const isLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '[::1]';

  if (!isProduction && isLoopback) {
    return;
  }

  ctx.addIssue({
    code: 'custom',
    path: [field],
    message: isProduction
      ? `${field} must use HTTPS.`
      : `${field} must use HTTPS unless it points to localhost in development.`,
  });
}

function validateTrustedOrigins(
  value: string | undefined,
  isProduction: boolean,
  ctx: z.RefinementCtx
): void {
  if (value === undefined) {
    return;
  }

  const origins = splitOrigins(value);

  if (origins.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUSTED_ORIGINS'],
      message: 'TRUSTED_ORIGINS must contain at least one origin when set.',
    });
    return;
  }

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUSTED_ORIGINS'],
        message: 'TRUSTED_ORIGINS contains an invalid URL.',
      });
      continue;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUSTED_ORIGINS'],
        message: 'TRUSTED_ORIGINS entries must use HTTP or HTTPS.',
      });
      continue;
    }

    validateOrigin(origin, 'TRUSTED_ORIGINS', isProduction, ctx);
  }
}

/**
 * Validate the operator's trusted media host list.
 *
 * Every entry must be a plain HTTPS origin. A media host is contacted by the
 * browser, so an entry that carried credentials, a path, or a query would
 * either leak a secret into the policy or silently never match.
 *
 * An empty (or whitespace-only) value is the same as an unset one: the
 * operator has not pinned the media hosts, and the policy allows any HTTPS
 * origin. The shipped `.env.example` sets the variable to an empty value, so
 * this case has to be a valid configuration rather than a startup failure.
 */
function validateAllowedMediaOrigins(
  value: string | undefined,
  ctx: z.RefinementCtx
): void {
  if (value === undefined || value.trim().length === 0) {
    return;
  }

  const origins = splitOrigins(value);

  if (origins.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['MEDIA_ALLOWED_HOSTS'],
      message: 'MEDIA_ALLOWED_HOSTS must contain at least one origin when set.',
    });
    return;
  }

  for (const origin of origins) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_ALLOWED_HOSTS'],
        message: 'MEDIA_ALLOWED_HOSTS contains an invalid URL.',
      });
      continue;
    }

    if (parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_ALLOWED_HOSTS'],
        message: 'MEDIA_ALLOWED_HOSTS entries must use HTTPS.',
      });
      continue;
    }

    if (parsed.username !== '' || parsed.password !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_ALLOWED_HOSTS'],
        message: 'MEDIA_ALLOWED_HOSTS entries must not contain credentials.',
      });
      continue;
    }

    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_ALLOWED_HOSTS'],
        message: 'MEDIA_ALLOWED_HOSTS entries must be an origin without a path, query, or fragment.',
      });
    }
  }
}

/**
 * Validate the browser push configuration.
 *
 * The VAPID key pair is all or nothing: a deployment with only the public key
 * could accept a subscription it can never deliver to, so a half-configured
 * pair is a configuration error rather than a silent partial setup.
 *
 * The contact address is what the push service shows the viewer, so it must
 * be a `mailto:` address or an HTTPS URL.
 *
 * The host allowlist names the push services the deployment trusts. Each entry
 * is a plain host name: a scheme, a path, or a port would never match the
 * host of an endpoint, and a silently ineffective allowlist is worse than
 * none.
 */
function validatePushConfiguration(
  value: {
    WEB_PUSH_PUBLIC_KEY?: string | undefined;
    WEB_PUSH_PRIVATE_KEY?: string | undefined;
    WEB_PUSH_SUBJECT?: string | undefined;
    PUSH_ALLOWED_HOSTS?: string | undefined;
  },
  ctx: z.RefinementCtx
): void {
  const hasPublicKey = value.WEB_PUSH_PUBLIC_KEY !== undefined;
  const hasPrivateKey = value.WEB_PUSH_PRIVATE_KEY !== undefined;

  if (hasPublicKey !== hasPrivateKey) {
    ctx.addIssue({
      code: 'custom',
      path: [hasPublicKey ? 'WEB_PUSH_PRIVATE_KEY' : 'WEB_PUSH_PUBLIC_KEY'],
      message: 'WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY must be set together.',
    });
  }

  if (value.WEB_PUSH_SUBJECT !== undefined) {
    const subject = value.WEB_PUSH_SUBJECT.trim();
    const isMailto = subject.toLowerCase().startsWith('mailto:');

    let isHttps = false;

    try {
      isHttps = new URL(subject).protocol === 'https:';
    } catch {
      isHttps = false;
    }

    if (!isMailto && !isHttps) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_PUSH_SUBJECT'],
        message: 'WEB_PUSH_SUBJECT must be a mailto: address or an HTTPS URL.',
      });
    }
  }

  if (value.PUSH_ALLOWED_HOSTS === undefined || value.PUSH_ALLOWED_HOSTS.trim().length === 0) {
    return;
  }

  const hosts = splitOrigins(value.PUSH_ALLOWED_HOSTS);

  if (hosts.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['PUSH_ALLOWED_HOSTS'],
      message: 'PUSH_ALLOWED_HOSTS must contain at least one host when set.',
    });
    return;
  }

  for (const host of hosts) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUSH_ALLOWED_HOSTS'],
        message: `PUSH_ALLOWED_HOSTS contains an invalid host: ${host}.`,
      });
    }
  }
}

/**
 * Keep uploaded artwork out of the source tree and the build output. A release
 * that replaces either directory must never delete user-supplied images.
 */
function validateImageStorageDir(
  value: string | undefined,
  isProduction: boolean,
  ctx: z.RefinementCtx
): void {
  if (value === undefined) {
    return;
  }

  const resolved = resolveImageStorageDir(value);
  const root = process.cwd();
  const forbidden = [path.join(root, 'src'), path.join(root, '.next')];

  if (forbidden.some(directory => resolved === directory || resolved.startsWith(`${directory}${path.sep}`))) {
    ctx.addIssue({
      code: 'custom',
      path: ['IMAGE_STORAGE_DIR'],
      message: 'IMAGE_STORAGE_DIR must not be inside the application source or build output.',
    });
    return;
  }

  // A production deployment replaces the release directory, so artwork stored
  // inside it is deleted with the previous release. The rule is rejected
  // instead of accepted silently.
  if (isProduction && (resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    ctx.addIssue({
      code: 'custom',
      path: ['IMAGE_STORAGE_DIR'],
      message:
        'IMAGE_STORAGE_DIR must point outside the application directory in production, for example /var/lib/dramascan/images.',
    });
  }
}

function validateTestDatabase(
  testDatabaseUrl: string | undefined,
  databaseUrl: string | undefined,
  ctx: z.RefinementCtx
): void {
  if (testDatabaseUrl === undefined) {
    return;
  }

  const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\//, ''));

  if (!databaseName.endsWith('_test')) {
    ctx.addIssue({
      code: 'custom',
      path: ['TEST_DATABASE_URL'],
      message: 'TEST_DATABASE_URL database name must end in _test.',
    });
  }

  if (databaseUrl !== undefined && testDatabaseUrl === databaseUrl) {
    ctx.addIssue({
      code: 'custom',
      path: ['TEST_DATABASE_URL'],
      message: 'TEST_DATABASE_URL must not equal DATABASE_URL.',
    });
  }
}

function formatIssue(issue: {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}): string {
  const path = issue.path.map(segment => String(segment)).join('.');
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}
