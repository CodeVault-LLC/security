import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

/**
 * Migration runner.
 *
 * Applies the hand-written SQL files in `drizzle/` in filename order, inside a
 * transaction each, recording a checksum so an already-applied migration cannot
 * be edited without the mismatch being reported.
 */

const MIGRATIONS_TABLE = "schema_migrations";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function migrationsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export async function runMigrations(
  connectionString: string,
): Promise<MigrationResult> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    const setupClient = await pool.connect();

    try {
      await ensureMigrationsTable(setupClient);
    } finally {
      setupClient.release();
    }

    const directory = migrationsDirectory();
    const entries = await readdir(directory);
    const files = entries.filter((name) => name.endsWith(".sql")).sort();

    for (const file of files) {
      const sql = await readFile(join(directory, file), "utf8");
      const checksum = checksumOf(sql);
      const client = await pool.connect();

      try {
        const existing = await client.query<{ checksum: string }>(
          `SELECT checksum FROM ${MIGRATIONS_TABLE} WHERE name = $1`,
          [file],
        );
        const previous = existing.rows[0];

        if (previous !== undefined) {
          if (previous.checksum !== checksum) {
            throw new Error(
              `Migration "${file}" was modified after it was applied. ` +
                `Add a new migration instead of editing an applied one.`,
            );
          }

          skipped.push(file);
          continue;
        }

        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES ($1, $2)`,
          [file, checksum],
        );
        await client.query("COMMIT");

        applied.push(file);
      } catch (error: unknown) {
        await client.query("ROLLBACK").catch(() => undefined);

        throw error;
      } finally {
        client.release();
      }
    }

    return { applied, skipped };
  } finally {
    await pool.end();
  }
}

/** CLI entry point: `bun run --cwd packages/db migrate`. */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.length === 0) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;

    return;
  }

  const result = await runMigrations(connectionString);

  for (const name of result.applied) {
    console.warn(`applied  ${name}`);
  }

  for (const name of result.skipped) {
    console.warn(`skipped  ${name}`);
  }

  console.warn(
    `${result.applied.length} applied, ${result.skipped.length} already present.`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await main();
}
