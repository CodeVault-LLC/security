import pg from "pg";

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

    const admins = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users WHERE role = 'ADMIN' AND disabled = false",
    );

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
