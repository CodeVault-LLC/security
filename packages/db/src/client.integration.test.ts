import { sql } from "drizzle-orm";
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

describeIntegration("database", () => {
  let handle: DatabaseHandle;

  beforeAll(() => {
    handle = createDatabase({ connectionString: connectionString as string });
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
          role: "MEMBER",
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
    const first = await allocateReference(handle.db, "asset");
    const second = await allocateReference(handle.db, "asset");

    expect(first).toMatch(/^AST-\d{6}$/);
    expect(second).toMatch(/^AST-\d{6}$/);
    expect(first).not.toBe(second);

    const firstSequence = Number(first.split("-")[1]);
    const secondSequence = Number(second.split("-")[1]);

    expect(secondSequence).toBe(firstSequence + 1);
  });

  it("year-scopes case and finding references", async () => {
    const reference = await allocateReference(handle.db, "finding");
    const year = new Date().getUTCFullYear();

    expect(reference).toMatch(new RegExp(`^FIND-${year}-\\d{4}$`));
  });

  it("refuses to update or delete an audit event", async () => {
    const id = uuidv7();

    await handle.db.execute(sql`
      INSERT INTO audit_events (id, action, entity_type, entity_id)
      VALUES (${id}, 'test.probe', 'test', 'probe')
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
});
