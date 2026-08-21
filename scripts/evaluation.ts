import { spawnSync } from "node:child_process";

import { eq } from "drizzle-orm";

import { createDatabase, runMigrations, schema } from "@codevault/db";
import { generateTotpAt } from "../apps/server/src/auth/totp.js";
import { parseMfaKeyring } from "../apps/server/src/auth/secret-keyring.js";
import { bootstrapOrganization } from "./bootstrap-admin.js";

const EMAIL = "evaluator@codevault.local";
const PASSWORD = "CodeVault-Evaluation-2026!";
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function localDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (value === undefined) throw new Error("DATABASE_URL is not set.");
  const parsed = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("The evaluation workspace requires a loopback database.");
  }
  return value;
}

async function setup(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Evaluation setup is disabled in production.");
  }
  const connectionString = localDatabaseUrl();
  const rawKeys = process.env.MFA_ENCRYPTION_KEYS;
  if (rawKeys === undefined || rawKeys.trim().length === 0) {
    throw new Error("MFA_ENCRYPTION_KEYS is not set.");
  }

  await runMigrations(connectionString);
  const handle = createDatabase({ connectionString });
  try {
    const organizations = await handle.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .limit(1);
    if (organizations.length === 0) {
      const now = new Date();
      await bootstrapOrganization(handle.db, {
        organization: "CodeVault Alpha 7 Evaluation",
        email: EMAIL,
        name: "Jordan Evaluator",
        password: PASSWORD,
        totpToken: generateTotpAt(TOTP_SECRET, now.getTime()),
        keyring: parseMfaKeyring(rawKeys),
        enrollment: {
          secretBytes: new Uint8Array(),
          manualSecret: TOTP_SECRET,
          provisioningUri:
            `otpauth://totp/CodeVault%20Evaluation:${encodeURIComponent(EMAIL)}` +
            `?secret=${TOTP_SECRET}&issuer=CodeVault%20Evaluation`,
        },
        now,
      });
    } else {
      const evaluator = await handle.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, EMAIL))
        .limit(1);
      if (evaluator.length === 0) {
        throw new Error(
          "This database already belongs to another workspace. Use the disposable evaluation database.",
        );
      }
    }
  } finally {
    await handle.close();
  }

  const { seedDevelopmentData } = await import("./seed-dev.js");
  await seedDevelopmentData();
  console.log("Alpha 7 evaluation workspace is ready.");
  console.log(`Email: ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log(`Current MFA code: ${generateTotpAt(TOTP_SECRET, Date.now())}`);
}

function code(): void {
  console.log(generateTotpAt(TOTP_SECRET, Date.now()));
}

async function start(): Promise<void> {
  const infra = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      "infra/docker-compose.yml",
      "-p",
      "codevault-alpha7-evaluation",
      "up",
      "-d",
      "--wait",
      "postgres",
      "objectstore",
      "objectstore-init",
      "media-db-init",
    ],
    { stdio: "inherit" },
  );
  if (infra.status !== 0) {
    throw new Error("Docker could not start the evaluation infrastructure.");
  }
  await setup();
  const application = spawnSync("bun", ["run", "dev"], {
    stdio: "inherit",
  });
  if (application.status !== 0 && application.signal === null) {
    throw new Error("The evaluation application stopped unexpectedly.");
  }
}

function remove(): void {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      "infra/docker-compose.yml",
      "-p",
      "codevault-alpha7-evaluation",
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("Docker could not remove the evaluation workspace.");
  }
}

const command = process.argv[2] ?? "start";
if (command === "start") await start();
else if (command === "setup") await setup();
else if (command === "code") code();
else if (command === "remove") remove();
else throw new Error("Usage: evaluation.ts <start|setup|code|remove>");
