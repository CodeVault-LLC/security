/**
 * Server configuration.
 *
 * Every setting is read once at startup and validated here, so a missing or
 * malformed value fails the process immediately rather than surfacing as a
 * confusing runtime error during a researcher's upload.
 */

import {
  parseTokenKeyring,
  type TokenKeyring,
} from "./modules/mail/token-crypto.js";
import type { GmailProviderEndpoints } from "./modules/mail/gmail-provider.js";
import {
  resolveSecretSettings,
  SecretConfigurationError,
} from "@codevault/core/configuration";

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
    /** Absolute lifetime of a session created with "Remember me". */
    sessionTtlHours: number;
    inviteTtlDays: number;
    loginMaxAttempts: number;
    loginAttemptWindowMinutes: number;
    minPasswordLength: number;
    mfaKeyring: SecretKeyring;
    webauthn: {
      rpName: string;
      rpId: string;
      origin: string;
      timeoutMs: number;
    };
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
  gmail:
    | { enabled: false }
    | {
        enabled: true;
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        tokenKeyring: TokenKeyring;
        endpoints: GmailProviderEndpoints | null;
        pubsub: null | {
          topicName: string;
          audience: string;
          serviceAccountEmail: string;
        };
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

const KNOWN_DEVELOPMENT_SECRETS = new Set([
  "codevault_dev_password",
  "codevault_media_dev_password",
  "codevault_ci",
  "change-me",
  "replace-me",
]);

function assertProductionSecretPosture(env: Environment): void {
  if (env.NODE_ENV !== "production") return;

  const databaseUrl = new URL(required(env, "DATABASE_URL"));
  const secretValues = [
    databaseUrl.password,
    required(env, "S3_SECRET_ACCESS_KEY"),
  ];
  if (secretValues.some((value) => KNOWN_DEVELOPMENT_SECRETS.has(value))) {
    throw new ConfigError(
      "Production configuration contains a known development credential.",
    );
  }
  if (required(env, "S3_ACCESS_KEY_ID") === "codevault") {
    throw new ConfigError(
      "Production S3_ACCESS_KEY_ID must not use the development identity.",
    );
  }
}

const MEGABYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEGABYTE;

const FILE_BACKED_SETTINGS = [
  "DATABASE_URL",
  "MFA_ENCRYPTION_KEYS",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "NVD_API_KEY",
  "GITHUB_ADVISORY_TOKEN",
  "GMAIL_CLIENT_SECRET",
  "MAIL_TOKEN_KEYRING",
] as const;

export function loadConfig(
  sourceEnvironment: Environment = process.env,
): ServerConfig {
  let env: Environment;
  try {
    env = resolveSecretSettings(sourceEnvironment, FILE_BACKED_SETTINGS);
  } catch (error: unknown) {
    if (error instanceof SecretConfigurationError) {
      throw new ConfigError(error.message);
    }
    throw error;
  }
  assertProductionSecretPosture(env);
  const serverPort = integer(env, "SERVER_PORT", 4310);
  const webauthnRpId = optional(env, "WEBAUTHN_RP_ID") ?? "localhost";
  const webauthnOrigin =
    optional(env, "WEBAUTHN_ORIGIN") ?? `http://localhost:${serverPort}`;
  const parsedWebauthnOrigin = new URL(webauthnOrigin);
  const webauthnLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsedWebauthnOrigin.hostname,
  );
  if (parsedWebauthnOrigin.origin !== webauthnOrigin.replace(/\/$/u, "")) {
    throw new ConfigError("WEBAUTHN_ORIGIN must be an origin without a path.");
  }
  if (parsedWebauthnOrigin.protocol !== "https:" && !webauthnLoopback) {
    throw new ConfigError(
      "WEBAUTHN_ORIGIN must use HTTPS except for an exact loopback origin.",
    );
  }
  if (
    parsedWebauthnOrigin.hostname !== webauthnRpId &&
    !parsedWebauthnOrigin.hostname.endsWith(`.${webauthnRpId}`)
  ) {
    throw new ConfigError(
      "WEBAUTHN_RP_ID must equal or be a registrable suffix of WEBAUTHN_ORIGIN.",
    );
  }
  const maxUploadBytes = integer(env, "MAX_UPLOAD_BYTES", 10 * GIBIBYTE);
  const gmailEnabled = boolean(env, "GMAIL_ENABLED", false);
  let gmail: ServerConfig["gmail"] = { enabled: false };

  if (gmailEnabled) {
    const clientId = required(env, "GMAIL_CLIENT_ID");
    const clientSecret = required(env, "GMAIL_CLIENT_SECRET");
    const redirectUri = required(env, "GMAIL_REDIRECT_URI");
    const parsedRedirect = new URL(redirectUri);
    const isLoopback =
      parsedRedirect.protocol === "http:" &&
      (parsedRedirect.hostname === "127.0.0.1" ||
        parsedRedirect.hostname === "[::1]");

    if (parsedRedirect.protocol !== "https:" && !isLoopback) {
      throw new ConfigError(
        "GMAIL_REDIRECT_URI must use HTTPS or an exact loopback HTTP address.",
      );
    }

    const e2eBaseUrl = optional(env, "GMAIL_E2E_BASE_URL");
    let endpoints: GmailProviderEndpoints | null = null;
    if (e2eBaseUrl !== null) {
      if (env.NODE_ENV !== "test") {
        throw new ConfigError(
          "GMAIL_E2E_BASE_URL is test-only and is refused outside NODE_ENV=test.",
        );
      }
      const parsedBase = new URL(e2eBaseUrl);
      if (
        parsedBase.protocol !== "http:" ||
        !["127.0.0.1", "[::1]"].includes(parsedBase.hostname)
      ) {
        throw new ConfigError(
          "GMAIL_E2E_BASE_URL must be an exact loopback HTTP address.",
        );
      }
      const base = e2eBaseUrl.replace(/\/$/, "");
      endpoints = {
        token: `${base}/token`,
        revoke: `${base}/revoke`,
        userInfo: `${base}/userinfo`,
        gmailApi: `${base}/gmail/v1`,
      };
    }

    gmail = {
      enabled: true,
      clientId,
      clientSecret,
      redirectUri,
      endpoints,
      tokenKeyring: parseTokenKeyring(
        required(env, "MAIL_TOKEN_KEYRING"),
        integer(env, "MAIL_ACTIVE_TOKEN_KEY_VERSION", 1),
      ),
      pubsub: (() => {
        const values = {
          topicName: optional(env, "GMAIL_PUBSUB_TOPIC"),
          audience: optional(env, "GMAIL_PUBSUB_AUDIENCE"),
          serviceAccountEmail: optional(
            env,
            "GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL",
          ),
        };
        if (Object.values(values).every((value) => value === null)) return null;
        if (Object.values(values).some((value) => value === null)) {
          throw new ConfigError(
            "Gmail Pub/Sub requires GMAIL_PUBSUB_TOPIC, GMAIL_PUBSUB_AUDIENCE, and GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL together.",
          );
        }
        return values as {
          topicName: string;
          audience: string;
          serviceAccountEmail: string;
        };
      })(),
    };
  }

  return {
    database: {
      connectionString: required(env, "DATABASE_URL"),
      maxConnections: integer(env, "DATABASE_MAX_CONNECTIONS", 10),
      ssl: boolean(env, "DATABASE_SSL", false),
    },
    server: {
      host: optional(env, "SERVER_HOST") ?? "127.0.0.1",
      port: serverPort,
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
      mfaKeyring: parseMfaKeyring(required(env, "MFA_ENCRYPTION_KEYS")),
      webauthn: {
        rpName: optional(env, "WEBAUTHN_RP_NAME") ?? "CodeVault Security",
        rpId: webauthnRpId,
        origin: parsedWebauthnOrigin.origin,
        timeoutMs: integer(env, "WEBAUTHN_TIMEOUT_MS", 120_000),
      },
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
    gmail,
  };
}

export { ConfigError };
import { parseMfaKeyring, type SecretKeyring } from "./auth/secret-keyring.js";
