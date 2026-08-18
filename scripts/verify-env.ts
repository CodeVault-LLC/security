import pg from "pg";

import { parseMfaKeyring } from "../apps/server/src/auth/secret-keyring.js";

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

function checkVariables(): CheckResult[] {
  const results: CheckResult[] = [];

  for (const name of REQUIRED_VARIABLES) {
    const value = process.env[name];
    const present = value !== undefined && value.trim().length > 0;

    results.push({
      name,
      ok: present,
      detail: present
        ? name.includes("SECRET") || name.includes("KEY")
          ? "set"
          : (value as string)
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
    const version = await pool.query<{ version: string }>("SELECT version()");
    const versionText = version.rows[0]?.version ?? "unknown";
    const major = /PostgreSQL (\d+)/.exec(versionText)?.[1];

    results.push({
      name: "database connection",
      ok: true,
      detail: versionText.split(",")[0] ?? versionText,
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
      ok: Number(migrations.rows[0]?.count ?? 0) > 0,
      detail: `${migrations.rows[0]?.count ?? 0} applied`,
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
      const response = await fetch(endpoint, { signal: controller.signal });

      // Any HTTP answer means something is listening; an S3 endpoint refusing
      // an unauthenticated request is exactly what should happen.
      return {
        name: "object storage",
        ok: true,
        detail: `${endpoint} responded ${response.status}`,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error: unknown) {
    return {
      name: "object storage",
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
