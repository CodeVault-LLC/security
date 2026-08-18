import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "@codevault/db";

import { parseMfaKeyring } from "../apps/server/src/auth/secret-keyring.js";
import {
  createTotpEnrollment,
  generateTotpAt,
} from "../apps/server/src/auth/totp.js";
import { bootstrapOrganization, parseArguments } from "./bootstrap-admin.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const databases: string[] = [];

async function temporaryDatabase(): Promise<{ url: string; pool: pg.Pool }> {
  const name = `codevault_bootstrap_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  databases.push(name);
  const url = new URL(connectionString!);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  for (const migration of [
    "0001_initial_schema.sql",
    "0002_ai_run_profiles.sql",
    "0003_ai_intake.sql",
    "0004_organization_security_mfa.sql",
    "0005_serialize_final_admin_check.sql",
  ]) {
    await pool.query(
      await readFile(
        join(import.meta.dirname, "../packages/db/drizzle", migration),
        "utf8",
      ),
    );
  }
  return { url: url.toString(), pool };
}

afterEach(async () => {
  for (const name of databases.splice(0)) {
    const admin = new pg.Pool({ connectionString });
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});

describe("bootstrap argument parsing", () => {
  it("requires an organization and bounded nonblank names", () => {
    expect(
      parseArguments(["--email", "a@b.test", "--name", "Admin"]),
    ).toBeNull();
    expect(
      parseArguments([
        "--organization",
        "Acme",
        "--email",
        "a@b.test",
        "--name",
        "Admin",
      ]),
    ).toMatchObject({ organization: "Acme", email: "a@b.test" });
  });
});

describeIntegration("organization bootstrap", () => {
  it("commits nothing for invalid TOTP and atomically creates all identity rows", async () => {
    const { url, pool } = await temporaryDatabase();
    const handle = createDatabase({ connectionString: url });
    const keyring = parseMfaKeyring(
      `test:${Buffer.alloc(32, 9).toString("base64")}`,
      false,
    );
    const enrollment = createTotpEnrollment("Acme Security", "admin@acme.test");
    const now = new Date("2026-08-18T10:00:00.000Z");
    const base = {
      organization: "Acme Security",
      email: "admin@acme.test",
      name: "Administrator",
      password: "a-correct-horse-battery-staple",
      keyring,
      enrollment,
      now,
    };

    await expect(
      bootstrapOrganization(handle.db, { ...base, totpToken: "000000" }),
    ).rejects.toThrow("authenticator code");
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM organizations"))
        .rows[0].count,
    ).toBe(0);

    const result = await bootstrapOrganization(handle.db, {
      ...base,
      totpToken: generateTotpAt(enrollment.manualSecret, now.getTime()),
    });
    expect(result.recoveryCodes).toHaveLength(10);
    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM organizations) AS organizations,
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM organization_memberships) AS memberships,
        (SELECT count(*)::int FROM totp_credentials) AS credentials,
        (SELECT count(*)::int FROM mfa_recovery_codes) AS recovery_codes,
        (SELECT count(*)::int FROM audit_events) AS audit_events
    `);
    expect(counts.rows[0]).toMatchObject({
      organizations: 1,
      users: 1,
      memberships: 1,
      credentials: 1,
      recovery_codes: 10,
      audit_events: 1,
    });
    await expect(
      bootstrapOrganization(handle.db, {
        ...base,
        totpToken: generateTotpAt(enrollment.manualSecret, now.getTime()),
      }),
    ).rejects.toThrow("already exists");

    await handle.close();
    await pool.end();
  });
});
