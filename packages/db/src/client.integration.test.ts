import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "@codevault/core/crypto";

import { createDatabase, type DatabaseHandle } from "./client.js";
import { allocateReference } from "./references.js";
import { users } from "./schema/auth.js";

/**
 * Database integration tests.
 *
 * Skipped unless `DATABASE_URL` points at a migrated development database, so
 * a contributor without Docker running still gets a green unit-test suite.
 */

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

async function withTemporaryDatabase(
  run: (pool: pg.Pool) => Promise<void>,
): Promise<void> {
  const databaseName = `codevault_migration_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: connectionString as string });
  const temporaryUrl = new URL(connectionString as string);
  temporaryUrl.pathname = `/${databaseName}`;

  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const pool = new pg.Pool({ connectionString: temporaryUrl.toString() });

  try {
    await run(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
}

async function applyMigrationFiles(
  pool: pg.Pool,
  names: readonly string[],
): Promise<void> {
  const directory = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "drizzle",
  );

  for (const name of names) {
    await pool.query(await readFile(join(directory, name), "utf8"));
  }
}

describeIntegration("database", () => {
  let handle: DatabaseHandle;
  let organizationId: string;
  let administratorId: string;

  beforeAll(async () => {
    handle = createDatabase({ connectionString: connectionString as string });

    const existing = await handle.db.execute<{
      organization_id: string;
      administrator_id: string;
    }>(sql`
      SELECT membership.organization_id, membership.user_id AS administrator_id
      FROM organization_memberships AS membership
      JOIN users AS account ON account.id = membership.user_id
      WHERE membership.role = 'ADMIN' AND account.disabled = false
      LIMIT 1
    `);
    const existingAdministrator = existing.rows[0];

    if (existingAdministrator !== undefined) {
      organizationId = existingAdministrator.organization_id;
      administratorId = existingAdministrator.administrator_id;
      return;
    }

    organizationId = uuidv7();
    administratorId = uuidv7();

    await handle.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO organizations (id, singleton_key, name)
        VALUES (${organizationId}, 1, 'Database Tests')
      `);
      await tx.execute(sql`
        INSERT INTO organization_security_policies (organization_id)
        VALUES (${organizationId})
      `);
      await tx.execute(sql`
        INSERT INTO users (id, email, display_name, password_hash)
        VALUES (
          ${administratorId},
          ${`database-admin-${administratorId}@codevault.test`},
          'Database Administrator',
          'not-a-real-hash'
        )
      `);
      await tx.execute(sql`
        INSERT INTO organization_memberships (organization_id, user_id, role)
        VALUES (${organizationId}, ${administratorId}, 'ADMIN')
      `);
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("connects and reports the expected server version", async () => {
    const result = await handle.db.execute<{ version: string }>(
      sql`SELECT version() AS version`,
    );

    expect(result.rows[0]?.version).toContain("PostgreSQL");
  });

  it("has the pg_trgm extension enabled", async () => {
    const result = await handle.db.execute<{ installed: boolean }>(
      sql`SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
      ) AS installed`,
    );

    expect(result.rows[0]?.installed).toBe(true);
  });

  it("rolls a transaction back completely", async () => {
    const email = `rollback-${uuidv7()}@codevault.test`;

    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(users).values({
          email,
          displayName: "Rollback Probe",
          passwordHash: "not-a-real-hash",
        });

        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow("deliberate rollback");

    const survivors = await handle.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM users WHERE email = ${email}`,
    );

    expect(survivors.rows[0]?.count).toBe("0");
  });

  it("allocates human references without gaps or collisions", async () => {
    const first = await allocateReference(handle.db, organizationId, "asset");
    const second = await allocateReference(handle.db, organizationId, "asset");

    expect(first).toMatch(/^AST-\d{6}$/);
    expect(second).toMatch(/^AST-\d{6}$/);
    expect(first).not.toBe(second);

    const firstSequence = Number(first.split("-")[1]);
    const secondSequence = Number(second.split("-")[1]);

    expect(secondSequence).toBe(firstSequence + 1);
  });

  it("year-scopes case and finding references", async () => {
    const reference = await allocateReference(
      handle.db,
      organizationId,
      "finding",
    );
    const year = new Date().getUTCFullYear();

    expect(reference).toMatch(new RegExp(`^FIND-${year}-\\d{4}$`));
  });

  it("refuses to update or delete an audit event", async () => {
    const id = uuidv7();

    await handle.db.execute(sql`
      INSERT INTO audit_events (
        id, organization_id, action, entity_type, entity_id
      )
      VALUES (${id}, ${organizationId}, 'test.probe', 'test', 'probe')
    `);

    await handle.db.execute(
      sql`UPDATE audit_events SET action = 'tampered' WHERE id = ${id}`,
    );
    await handle.db.execute(sql`DELETE FROM audit_events WHERE id = ${id}`);

    const surviving = await handle.db.execute<{ action: string }>(
      sql`SELECT action FROM audit_events WHERE id = ${id}`,
    );

    expect(surviving.rows[0]?.action).toBe("test.probe");
  });

  it("rejects an asset relationship that points at itself", async () => {
    await expect(
      handle.db.execute(sql`
        INSERT INTO asset_relationships
          (id, from_asset_id, to_asset_id, relationship, created_by)
        VALUES (
          ${uuidv7()}, ${uuidv7()}, ${uuidv7()}, 'CONTAINS', ${uuidv7()}
        )
      `),
    ).rejects.toThrow();
  });

  it("keeps a fresh migrated database without an organization", async () => {
    await withTemporaryDatabase(async (pool) => {
      await applyMigrationFiles(pool, [
        "0001_initial_schema.sql",
        "0002_ai_run_profiles.sql",
        "0003_ai_intake.sql",
        "0004_organization_security_mfa.sql",
      ]);

      const result = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM organizations",
      );
      expect(result.rows[0]?.count).toBe("0");
    });
  });

  it("serializes administrators racing to remove each other", async () => {
    await withTemporaryDatabase(async (pool) => {
      await applyMigrationFiles(pool, [
        "0001_initial_schema.sql",
        "0002_ai_run_profiles.sql",
        "0003_ai_intake.sql",
        "0004_organization_security_mfa.sql",
        "0005_serialize_final_admin_check.sql",
      ]);

      const organization = uuidv7();
      const firstAdmin = uuidv7();
      const secondAdmin = uuidv7();

      await pool.query("BEGIN");
      try {
        await pool.query(
          `INSERT INTO organizations (id, name) VALUES ($1, 'Race Test')`,
          [organization],
        );
        await pool.query(
          `INSERT INTO organization_security_policies (organization_id)
           VALUES ($1)`,
          [organization],
        );
        for (const [id, email] of [
          [firstAdmin, "race-first@codevault.test"],
          [secondAdmin, "race-second@codevault.test"],
        ]) {
          await pool.query(
            `INSERT INTO users (id, email, display_name, password_hash)
             VALUES ($1, $2, 'Race Administrator', 'not-a-real-hash')`,
            [id, email],
          );
          await pool.query(
            `INSERT INTO organization_memberships
               (organization_id, user_id, role)
             VALUES ($1, $2, 'ADMIN')`,
            [organization, id],
          );
        }
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }

      const first = await pool.connect();
      const second = await pool.connect();
      try {
        await Promise.all([first.query("BEGIN"), second.query("BEGIN")]);
        await Promise.all([
          first.query(
            `UPDATE organization_memberships SET role = 'MEMBER'
             WHERE organization_id = $1 AND user_id = $2`,
            [organization, secondAdmin],
          ),
          second.query(`UPDATE users SET disabled = true WHERE id = $1`, [
            firstAdmin,
          ]),
        ]);

        const commits = await Promise.allSettled([
          first.query("COMMIT"),
          second.query("COMMIT"),
        ]);
        expect(
          commits.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
          commits.filter((result) => result.status === "rejected"),
        ).toHaveLength(1);

        const active = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM organization_memberships AS membership
           JOIN users AS account ON account.id = membership.user_id
           WHERE membership.organization_id = $1
             AND membership.role = 'ADMIN'
             AND account.disabled = false`,
          [organization],
        );
        expect(active.rows[0]?.count).toBe("1");
      } finally {
        first.release();
        second.release();
      }
    });
  });

  it("backfills one organization and transfers every existing role", async () => {
    await withTemporaryDatabase(async (pool) => {
      await applyMigrationFiles(pool, [
        "0001_initial_schema.sql",
        "0002_ai_run_profiles.sql",
        "0003_ai_intake.sql",
      ]);

      const fixtures = [
        [uuidv7(), "legacy-admin@codevault.test", "ADMIN", false],
        [uuidv7(), "legacy-member@codevault.test", "MEMBER", false],
        [uuidv7(), "legacy-viewer@codevault.test", "VIEWER", true],
      ] as const;

      for (const [id, email, role, disabled] of fixtures) {
        await pool.query(
          `INSERT INTO users
             (id, email, display_name, password_hash, role, disabled)
           VALUES ($1, $2, $3, 'not-a-real-hash', $4, $5)`,
          [id, email, role, role, disabled],
        );
      }

      await applyMigrationFiles(pool, ["0004_organization_security_mfa.sql"]);

      const organizations = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM organizations",
      );
      const memberships = await pool.query<{ email: string; role: string }>(`
        SELECT account.email, membership.role
        FROM organization_memberships AS membership
        JOIN users AS account ON account.id = membership.user_id
        ORDER BY account.email
      `);
      const legacyRoleColumn = await pool.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'role'
        ) AS exists
      `);

      expect(organizations.rows[0]?.count).toBe("1");
      expect(memberships.rows).toEqual([
        { email: "legacy-admin@codevault.test", role: "ADMIN" },
        { email: "legacy-member@codevault.test", role: "MEMBER" },
        { email: "legacy-viewer@codevault.test", role: "VIEWER" },
      ]);
      expect(legacyRoleColumn.rows[0]?.exists).toBe(false);
    });
  });

  it("enforces the single-organization boundary in the database", async () => {
    const secondId = uuidv7();

    await expect(
      handle.db.execute(sql`
        INSERT INTO organizations (id, singleton_key, name)
        VALUES (${secondId}, 1, 'Second organization')
      `),
    ).rejects.toThrow();
  });

  it("requires every organization to retain an active administrator", async () => {
    const before = await handle.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM organization_memberships AS membership
      JOIN users AS account ON account.id = membership.user_id
      WHERE membership.organization_id = ${organizationId}
        AND membership.role = 'ADMIN'
        AND account.disabled = false
    `);
    let failure: unknown;

    try {
      await handle.db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE users
          SET disabled = true
          WHERE id IN (
            SELECT membership.user_id
            FROM organization_memberships AS membership
            WHERE membership.organization_id = ${organizationId}
              AND membership.role = 'ADMIN'
          )
        `);
      });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(
      (failure as { cause?: { constraint?: string } }).cause?.constraint,
    ).toBe("organization_requires_active_admin");

    const activeAdministrators = await handle.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM organization_memberships AS membership
      JOIN users AS account ON account.id = membership.user_id
      WHERE membership.organization_id = ${organizationId}
        AND membership.role = 'ADMIN'
        AND account.disabled = false
    `);
    expect(activeAdministrators.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
