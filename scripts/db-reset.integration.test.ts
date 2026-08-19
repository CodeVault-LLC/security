import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { resetDatabase } from "./db-reset.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const databases: string[] = [];

async function temporaryDatabase(): Promise<string> {
  const name = `codevault_reset_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  databases.push(name);

  const url = new URL(connectionString!);
  url.pathname = `/${name}`;
  return url.toString();
}

afterEach(async () => {
  for (const name of databases.splice(0)) {
    const admin = new pg.Pool({ connectionString });
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});

describeIntegration("database reset", () => {
  it("removes existing data and leaves a fully migrated empty schema", async () => {
    const url = await temporaryDatabase();
    const before = new pg.Pool({ connectionString: url });
    await before.query("CREATE TABLE throwaway (id integer PRIMARY KEY)");
    await before.query("INSERT INTO throwaway (id) VALUES (1)");
    await before.end();

    const result = await resetDatabase(url, "development");
    const after = new pg.Pool({ connectionString: url });
    const state = await after.query<{
      migration_count: string;
      organization_count: string;
      throwaway: string | null;
    }>(`
      SELECT
        (SELECT count(*)::text FROM schema_migrations) AS migration_count,
        (SELECT count(*)::text FROM organizations) AS organization_count,
        to_regclass('public.throwaway')::text AS throwaway
    `);
    await after.end();

    expect(result.applied.length).toBeGreaterThan(0);
    expect(state.rows[0]).toEqual({
      migration_count: String(result.applied.length),
      organization_count: "0",
      throwaway: null,
    });
  });
});
