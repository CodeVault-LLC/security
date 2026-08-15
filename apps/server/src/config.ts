/**
 * Server configuration.
 *
 * Every setting is read once at startup and validated here, so a missing or
 * malformed value fails the process immediately rather than surfacing as a
 * confusing runtime error during a researcher's upload.
 */

export interface ServerConfig {
  database: {
    connectionString: string;
    maxConnections: number;
    ssl: boolean;
  };
  server: {
    host: string;
    port: number;
    corsOrigins: string[];
    logLevel: string;
  };
  auth: {
    sessionTtlHours: number;
    inviteTtlDays: number;
    loginMaxAttempts: number;
    loginAttemptWindowMinutes: number;
    minPasswordLength: number;
  };
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    maxUploadBytes: number;
    presignedUrlTtlSeconds: number;
    /** Above this size the client uses a multipart upload. */
    multipartThresholdBytes: number;
    multipartPartSizeBytes: number;
  };
  priorArt: {
    nvdApiKey: string | null;
    githubAdvisoryToken: string | null;
    userAgent: string;
  };
}

class ConfigError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "ConfigError";
  }
}

type Environment = Record<string, string | undefined>;

function required(env: Environment, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new ConfigError(`Required environment variable ${key} is not set.`);
  }

  return value.trim();
}

function optional(env: Environment, key: string): string | null {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

function integer(env: Environment, key: string, fallback: number): number {
  const raw = optional(env, key);

  if (raw === null) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${key} must be a positive integer, got "${raw}".`);
  }

  return parsed;
}

function boolean(env: Environment, key: string, fallback: boolean): boolean {
  const raw = optional(env, key);

  if (raw === null) {
    return fallback;
  }

  return raw.toLowerCase() === "true" || raw === "1";
}

function list(env: Environment, key: string): string[] {
  const raw = optional(env, key);

  if (raw === null) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const MEGABYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEGABYTE;

export function loadConfig(env: Environment = process.env): ServerConfig {
  const maxUploadBytes = integer(env, "MAX_UPLOAD_BYTES", 10 * GIBIBYTE);

  return {
    database: {
      connectionString: required(env, "DATABASE_URL"),
      maxConnections: integer(env, "DATABASE_MAX_CONNECTIONS", 10),
      ssl: boolean(env, "DATABASE_SSL", false),
    },
    server: {
      host: optional(env, "SERVER_HOST") ?? "127.0.0.1",
      port: integer(env, "SERVER_PORT", 4310),
      corsOrigins: list(env, "SERVER_CORS_ORIGINS"),
      logLevel: optional(env, "LOG_LEVEL") ?? "info",
    },
    auth: {
      sessionTtlHours: integer(env, "SESSION_TTL_HOURS", 168),
      inviteTtlDays: integer(env, "INVITE_TTL_DAYS", 7),
      loginMaxAttempts: integer(env, "LOGIN_MAX_ATTEMPTS", 10),
      loginAttemptWindowMinutes: integer(
        env,
        "LOGIN_ATTEMPT_WINDOW_MINUTES",
        15,
      ),
      // Long enough to matter, short enough that a passphrase is practical.
      minPasswordLength: 12,
    },
    storage: {
      endpoint: required(env, "S3_ENDPOINT"),
      region: optional(env, "S3_REGION") ?? "us-east-1",
      bucket: required(env, "S3_BUCKET"),
      accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
      forcePathStyle: boolean(env, "S3_FORCE_PATH_STYLE", true),
      maxUploadBytes,
      presignedUrlTtlSeconds: integer(env, "PRESIGNED_URL_TTL_SECONDS", 900),
      multipartThresholdBytes: 64 * MEGABYTE,
      multipartPartSizeBytes: 32 * MEGABYTE,
    },
    priorArt: {
      nvdApiKey: optional(env, "NVD_API_KEY"),
      githubAdvisoryToken: optional(env, "GITHUB_ADVISORY_TOKEN"),
      userAgent:
        optional(env, "PRIOR_ART_USER_AGENT") ??
        "CodeVault/1.0 (security research platform)",
    },
  };
}

export { ConfigError };
