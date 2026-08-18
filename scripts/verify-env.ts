import pg from "pg";

import { parseMfaKeyring } from "../apps/server/src/auth/secret-keyring.js";
import { environmentValueDetail } from "./verify-env-helpers.js";

/**
 * Environment check.
 *
 * Run before a deployment, or when something is not working and the cause is
 * probably configuration. Every check reports what it found rather than only
 * pass or fail, because "S3_BUCKET is set" is less useful than knowing which
 * bucket it points at.
 */

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const REQUIRED_VARIABLES = [
  "DATABASE_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "MFA_ENCRYPTION_KEYS",
] as const;

/** Variables that are optional but change behaviour when absent. */
const OPTIONAL_VARIABLES: Array<[string, string]> = [
  ["NVD_API_KEY", "NVD is queried without a key, at a much lower rate limit"],
  ["GITHUB_ADVISORY_TOKEN", "GitHub Security Advisories are skipped"],
  [
    "SERVER_CORS_ORIGINS",
    "no browser origin is allowed, which is correct for the desktop client",
  ],
];

const MEDIA_RUNTIME_VARIABLES = [
  "MEDIA_DATABASE_URL",
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
] as const;

function checkVariables(): CheckResult[] {
  const results: CheckResult[] = [];

  for (const name of REQUIRED_VARIABLES) {
    const value = process.env[name];
    const present = value !== undefined && value.trim().length > 0;

    results.push({
      name,
      ok: present,
      detail: present
        ? environmentValueDetail(name, value as string)
        : "missing",
    });
  }

  for (const [name, consequence] of OPTIONAL_VARIABLES) {
    const value = process.env[name];
    const present = value !== undefined && value.trim().length > 0;

    results.push({
      name,
      ok: true,
      detail: present ? "set" : `not set — ${consequence}`,
    });
  }

  for (const name of MEDIA_RUNTIME_VARIABLES) {
    const present = Boolean(process.env[name]?.trim());
    results.push({
      name,
      ok: process.env.NODE_ENV !== "production" || present,
      detail: present
        ? name.includes("SECRET") || name.includes("KEY")
          ? "set"
          : "set"
        : "not set — dedicated media credentials are required in production",
    });
  }

  const gmailEnabled = ["true", "1"].includes(
    (process.env.GMAIL_ENABLED ?? "").toLowerCase(),
  );
  results.push({
    name: "Gmail integration",
    ok: true,
    detail: gmailEnabled ? "enabled" : "disabled by default",
  });

  if (gmailEnabled) {
    for (const name of [
      "GMAIL_CLIENT_ID",
      "GMAIL_CLIENT_SECRET",
      "GMAIL_REDIRECT_URI",
      "MAIL_TOKEN_KEYRING",
      "MAIL_ACTIVE_TOKEN_KEY_VERSION",
    ]) {
      const value = process.env[name];
      const present = value !== undefined && value.trim().length > 0;
      results.push({
        name,
        ok: present,
        detail: present
          ? name.includes("SECRET") || name.includes("KEYRING")
            ? "set"
            : value
          : "missing — required when Gmail is enabled",
      });
    }

    const keyring = process.env.MAIL_TOKEN_KEYRING ?? "";
    const activeVersion = process.env.MAIL_ACTIVE_TOKEN_KEY_VERSION ?? "";
    const keys = new Map(
      keyring.split(",").flatMap((entry) => {
        const separator = entry.indexOf(":");
        if (separator < 1) return [];
        return [
          [entry.slice(0, separator), entry.slice(separator + 1)] as const,
        ];
      }),
    );
    const activeKey = keys.get(activeVersion);
    const activeKeyValid =
      activeKey !== undefined &&
      Buffer.from(activeKey, "base64").byteLength === 32;
    results.push({
      name: "active Gmail token key",
      ok: activeKeyValid,
      detail: activeKeyValid
        ? `version ${activeVersion} is 32 bytes`
        : "active version is absent or is not a 32-byte base64 key",
    });

    const redirect = process.env.GMAIL_REDIRECT_URI;
    let redirectSafe = false;
    try {
      if (redirect !== undefined) {
        const url = new URL(redirect);
        redirectSafe =
          url.protocol === "https:" ||
          (url.protocol === "http:" &&
            (url.hostname === "127.0.0.1" || url.hostname === "[::1]"));
      }
    } catch {
      redirectSafe = false;
    }
    results.push({
      name: "Gmail redirect transport",
      ok: redirectSafe,
      detail: redirectSafe
        ? "HTTPS or exact loopback"
        : "must be HTTPS or exact loopback HTTP",
    });

    const pubsubNames = [
      "GMAIL_PUBSUB_TOPIC",
      "GMAIL_PUBSUB_AUDIENCE",
      "GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL",
    ] as const;
    const pubsubSet = pubsubNames.filter(
      (name) => (process.env[name] ?? "").trim().length > 0,
    );
    results.push({
      name: "Gmail Pub/Sub settings",
      ok: pubsubSet.length === 0 || pubsubSet.length === pubsubNames.length,
      detail:
        pubsubSet.length === 0
          ? "disabled; the polling fallback remains active"
          : pubsubSet.length === pubsubNames.length
            ? "topic, audience, and service account are all set"
            : "set all three Pub/Sub variables together",
    });

    const e2eBaseUrl = process.env.GMAIL_E2E_BASE_URL;
    results.push({
      name: "fake Gmail endpoint isolation",
      ok: e2eBaseUrl === undefined || process.env.NODE_ENV === "test",
      detail:
        e2eBaseUrl === undefined
          ? "no fake endpoint configured"
          : process.env.NODE_ENV === "test"
            ? "enabled only for the test process"
            : "GMAIL_E2E_BASE_URL is forbidden outside NODE_ENV=test",
    });
  }

  return results;
}

async function checkDatabase(): Promise<CheckResult[]> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined) {
    return [{ name: "database", ok: false, detail: "DATABASE_URL is not set" }];
  }

  const pool = new pg.Pool({ connectionString, max: 1 });
  const results: CheckResult[] = [];

  try {
    const queryStartedAt = Date.now();
    const version = await pool.query<{ version: string; database_ms: string }>(
      "SELECT version(), extract(epoch FROM clock_timestamp()) * 1000 AS database_ms",
    );
    const queryFinishedAt = Date.now();
    const versionText = version.rows[0]?.version ?? "unknown";
    const major = /PostgreSQL (\d+)/.exec(versionText)?.[1];

    results.push({
      name: "database connection",
      ok: true,
      detail: versionText.split(",")[0] ?? versionText,
    });

    const databaseMs = Number(version.rows[0]?.database_ms);
    const clockDifference = Math.abs(
      databaseMs - (queryStartedAt + queryFinishedAt) / 2,
    );
    results.push({
      name: "database clock difference",
      ok: Number.isFinite(clockDifference) && clockDifference < 2_000,
      detail: Number.isFinite(clockDifference)
        ? `${Math.round(clockDifference)} ms`
        : "unknown",
    });

    results.push({
      name: "PostgreSQL 18 or newer",
      ok: major !== undefined && Number(major) >= 18,
      detail:
        major === undefined ? "unknown version" : `major version ${major}`,
    });

    const extension = await pool.query<{ installed: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS installed",
    );

    results.push({
      name: "pg_trgm extension",
      ok: extension.rows[0]?.installed === true,
      detail:
        extension.rows[0]?.installed === true
          ? "installed"
          : "missing — run the migrations",
    });

    const migrations = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations",
    );

    results.push({
      name: "migrations applied",
      ok: Number(migrations.rows[0]?.count ?? 0) >= 15,
      detail: `${migrations.rows[0]?.count ?? 0} applied`,
    });

    const staleVendorSeeds = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM vendors
       WHERE built_in = true
         AND (source_url IS NULL OR source_reviewed_at IS NULL
              OR source_reviewed_at < now() - interval '180 days')`,
    );
    const staleRouteSeeds = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM vendor_routes
       WHERE built_in = true
         AND (source_url IS NULL OR source_reviewed_at IS NULL
              OR source_reviewed_at < now() - interval '180 days')`,
    );
    const staleSeeds =
      Number(staleVendorSeeds.rows[0]?.count ?? 0) +
      Number(staleRouteSeeds.rows[0]?.count ?? 0);
    results.push({
      name: "built-in vendor provenance",
      ok: staleSeeds === 0,
      detail:
        staleSeeds === 0
          ? "all official sources were reviewed within 180 days"
          : `${staleSeeds} vendor or route seed(s) need source review`,
    });

    const admins = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM organization_memberships AS membership
      JOIN users AS account ON account.id = membership.user_id
      WHERE membership.role = 'ADMIN' AND account.disabled = false
    `);

    const adminCount = Number(admins.rows[0]?.count ?? 0);

    results.push({
      name: "administrator exists",
      ok: adminCount > 0,
      detail:
        adminCount > 0
          ? `${adminCount} enabled administrator(s)`
          : "none — run `bun run admin:create`",
    });

    const missingMfa = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM users AS account
      JOIN organization_memberships AS membership ON membership.user_id = account.id
      LEFT JOIN totp_credentials AS credential
        ON credential.user_id = account.id AND credential.replaced_at IS NULL
      WHERE account.disabled = false AND credential.id IS NULL
    `);
    const missingMfaCount = Number(missingMfa.rows[0]?.count ?? 0);
    results.push({
      name: "active users enrolled in MFA",
      ok: missingMfaCount === 0,
      detail:
        missingMfaCount === 0
          ? "all enrolled"
          : `${missingMfaCount} active user(s) require enrollment`,
    });

    const unsafeAvatars = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM avatar_images
      WHERE status = 'READY'
        AND (sanitized_object_key IS NULL OR sanitized_object_key LIKE 'quarantine/%')
    `);
    const unsafeAvatarCount = Number(unsafeAvatars.rows[0]?.count ?? 0);
    results.push({
      name: "ready avatar derivatives",
      ok: unsafeAvatarCount === 0,
      detail:
        unsafeAvatarCount === 0
          ? "all point to sanitized storage"
          : `${unsafeAvatarCount} unsafe ready avatar row(s)`,
    });

    const mediaPrivileges = await pool.query<{
      can_read_users: boolean;
      can_claim: boolean;
      can_complete: boolean;
      can_fail: boolean;
    }>(`
      SELECT
        has_table_privilege('codevault_media_runtime', 'public.users', 'SELECT') AS can_read_users,
        has_function_privilege('codevault_media_runtime', 'public.claim_media_job(text,text)', 'EXECUTE') AS can_claim,
        has_function_privilege('codevault_media_runtime', 'public.complete_media_job(uuid,text,text,text,integer,integer)', 'EXECUTE') AS can_complete,
        has_function_privilege('codevault_media_runtime', 'public.fail_media_job(uuid,text,text,boolean)', 'EXECUTE') AS can_fail
    `);
    const media = mediaPrivileges.rows[0];
    const mediaRoleOk =
      media?.can_read_users === false &&
      media.can_claim &&
      media.can_complete &&
      media.can_fail;
    results.push({
      name: "media database capability role",
      ok: mediaRoleOk === true,
      detail:
        mediaRoleOk === true
          ? "function-only access confirmed"
          : "unexpected table or function privileges",
    });
  } catch (error: unknown) {
    results.push({
      name: "database connection",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await pool.end();
  }

  return results;
}

async function checkMediaDatabase(): Promise<CheckResult> {
  const connectionString = process.env.MEDIA_DATABASE_URL;
  if (!connectionString) {
    return {
      name: "media runtime database login",
      ok: process.env.NODE_ENV !== "production",
      detail:
        process.env.NODE_ENV === "production"
          ? "MEDIA_DATABASE_URL is required in production"
          : "not set — production must use a dedicated runtime login",
    };
  }

  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const privileges = await pool.query<{
      can_read_users: boolean;
      can_claim: boolean;
    }>(`
      SELECT
        has_table_privilege(current_user, 'public.users', 'SELECT') AS can_read_users,
        has_function_privilege(current_user, 'public.claim_media_job(text,text)', 'EXECUTE') AS can_claim
    `);
    const row = privileges.rows[0];
    return {
      name: "media runtime database login",
      ok: row?.can_read_users === false && row.can_claim === true,
      detail:
        row?.can_read_users === false && row.can_claim === true
          ? "cannot read users; can execute media capability"
          : "login is not least privilege",
    };
  } catch (error) {
    return {
      name: "media runtime database login",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await pool.end();
  }
}

function checkMfaKeyring(): CheckResult {
  const raw = process.env.MFA_ENCRYPTION_KEYS;
  if (raw === undefined) {
    return { name: "MFA keyring", ok: false, detail: "missing" };
  }

  try {
    const keyring = parseMfaKeyring(raw);
    const envelope = keyring.encrypt("verification", "environment-check");
    const recovered = keyring
      .decrypt(envelope, "environment-check")
      .toString("utf8");

    return {
      name: "MFA keyring",
      ok: recovered === "verification",
      detail:
        recovered === "verification" ? "encrypt/decrypt passed" : "failed",
    };
  } catch {
    return { name: "MFA keyring", ok: false, detail: "invalid" };
  }
}

async function checkObjectStorage(): Promise<CheckResult> {
  const endpoint = process.env.S3_ENDPOINT;

  if (endpoint === undefined) {
    return {
      name: "object storage",
      ok: false,
      detail: "S3_ENDPOINT is not set",
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    try {
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new Error("S3_BUCKET is not set");
      const url = new URL(endpoint);
      if (process.env.S3_FORCE_PATH_STYLE === "false") {
        url.hostname = `${bucket}.${url.hostname}`;
      } else {
        url.pathname = `${url.pathname.replace(/\/$/u, "")}/${encodeURIComponent(bucket)}`;
      }
      const response = await fetch(url, { signal: controller.signal });

      return {
        name: "object storage bucket privacy",
        ok: response.status === 401 || response.status === 403,
        detail: `${url.origin} responded ${response.status} to anonymous bucket access`,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error: unknown) {
    return {
      name: "object storage bucket privacy",
      ok: false,
      detail: `${endpoint} unreachable (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }
}

async function main(): Promise<void> {
  const results = [
    ...checkVariables(),
    checkMfaKeyring(),
    ...(await checkDatabase()),
    await checkMediaDatabase(),
    await checkObjectStorage(),
  ];

  const width = Math.max(...results.map((result) => result.name.length));

  for (const result of results) {
    const mark = result.ok ? "ok  " : "FAIL";

    console.warn(`${mark}  ${result.name.padEnd(width)}  ${result.detail}`);
  }

  const failures = results.filter((result) => !result.ok);

  console.warn("");
  console.warn(
    failures.length === 0
      ? `All ${results.length} checks passed.`
      : `${failures.length} of ${results.length} checks failed.`,
  );

  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
