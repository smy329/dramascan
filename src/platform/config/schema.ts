import { z } from "zod";

export type Environment = "development" | "test" | "production";

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
}>;

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      ["Invalid environment configuration:", ...issues.map((issue) => `- ${issue}`)].join("\n"),
    );
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

const httpUrlSchema = z.url({ protocol: /^https?$/ });
const postgresUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });
const emailSchema = z.email().transform((value) => value.toLowerCase());

const rawServerConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    APP_URL: httpUrlSchema.optional(),
    TRUSTED_ORIGINS: z.string().optional(),
    DATABASE_URL: postgresUrlSchema.optional(),
    TEST_DATABASE_URL: postgresUrlSchema.optional(),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must contain at least 32 characters.")
      .optional(),
    GOOGLE_CLIENT_ID: z.string().min(10, "GOOGLE_CLIENT_ID is too short.").optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(10, "GOOGLE_CLIENT_SECRET is too short.").optional(),
    SUPER_ADMIN_EMAIL: emailSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const isProduction = value.NODE_ENV === "production";
    const appUrl = value.APP_URL ?? (isProduction ? undefined : "http://localhost:3000");

    if (appUrl === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "APP_URL is required in production.",
      });
    } else {
      validateOrigin(appUrl, "APP_URL", isProduction, ctx);
    }

    if (isProduction) {
      const requiredFields = [
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "SUPER_ADMIN_EMAIL",
      ] as const;

      for (const field of requiredFields) {
        if (value[field] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required in production.`,
          });
        }
      }
    }

    validateTrustedOrigins(value.TRUSTED_ORIGINS, isProduction, ctx);
    validateTestDatabase(value.TEST_DATABASE_URL, value.DATABASE_URL, ctx);
  })
  .transform((value) => toServerConfig(value));

export function parseServerConfig(
  input: Record<string, string | undefined>,
  fallbackNodeEnv: string = "development",
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
}>;

function toServerConfig(value: RawEnvironment): ServerConfig {
  const isProduction = value.NODE_ENV === "production";
  const appUrl = normalizeOrigin(value.APP_URL ?? "http://localhost:3000");
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
  });
}

function normalizeInput(input: Record<string, string | undefined>): Record<string, string> {
  const entries = Object.entries(input).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function splitOrigins(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

function validateOrigin(
  value: string,
  field: string,
  isProduction: boolean,
  ctx: z.RefinementCtx,
): void {
  const parsed = new URL(value);

  if (parsed.username !== "" || parsed.password !== "") {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `${field} must not contain credentials.`,
    });
    return;
  }

  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `${field} must be an origin without a path, query, or fragment.`,
    });
    return;
  }

  if (parsed.protocol === "https:") {
    return;
  }

  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]";

  if (!isProduction && isLoopback) {
    return;
  }

  ctx.addIssue({
    code: "custom",
    path: [field],
    message: isProduction
      ? `${field} must use HTTPS.`
      : `${field} must use HTTPS unless it points to localhost in development.`,
  });
}

function validateTrustedOrigins(
  value: string | undefined,
  isProduction: boolean,
  ctx: z.RefinementCtx,
): void {
  if (value === undefined) {
    return;
  }

  const origins = splitOrigins(value);

  if (origins.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["TRUSTED_ORIGINS"],
      message: "TRUSTED_ORIGINS must contain at least one origin when set.",
    });
    return;
  }

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["TRUSTED_ORIGINS"],
        message: "TRUSTED_ORIGINS contains an invalid URL.",
      });
      continue;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        path: ["TRUSTED_ORIGINS"],
        message: "TRUSTED_ORIGINS entries must use HTTP or HTTPS.",
      });
      continue;
    }

    validateOrigin(origin, "TRUSTED_ORIGINS", isProduction, ctx);
  }
}

function validateTestDatabase(
  testDatabaseUrl: string | undefined,
  databaseUrl: string | undefined,
  ctx: z.RefinementCtx,
): void {
  if (testDatabaseUrl === undefined) {
    return;
  }

  const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\//, ""));

  if (!databaseName.endsWith("_test")) {
    ctx.addIssue({
      code: "custom",
      path: ["TEST_DATABASE_URL"],
      message: "TEST_DATABASE_URL database name must end in _test.",
    });
  }

  if (databaseUrl !== undefined && testDatabaseUrl === databaseUrl) {
    ctx.addIssue({
      code: "custom",
      path: ["TEST_DATABASE_URL"],
      message: "TEST_DATABASE_URL must not equal DATABASE_URL.",
    });
  }
}

function formatIssue(issue: {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}): string {
  const path = issue.path.map((segment) => String(segment)).join(".");
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}
