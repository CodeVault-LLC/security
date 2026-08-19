import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { runMigrations, type MigrationResult } from "@codevault/db";

export class DatabaseResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseResetError";
  }
}

function databaseName(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DatabaseResetError("DATABASE_URL is not a valid URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DatabaseResetError("DATABASE_URL must use PostgreSQL.");
  }

  const name = decodeURIComponent(url.pathname.slice(1));
  if (name.length === 0) {
    throw new DatabaseResetError("DATABASE_URL must name a database.");
  }

  return name;
}

export function assertDatabaseResetAllowed(
  connectionString: string,
  environment: string | undefined,
): void {
  const name = databaseName(connectionString);
  const url = new URL(connectionString);

  if (environment?.toLowerCase() === "production") {
    throw new DatabaseResetError("Refusing to reset a production database.");
  }

  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new DatabaseResetError(
      "Database reset is limited to local PostgreSQL instances.",
    );
  }

  if (["postgres", "template0", "template1"].includes(name)) {
    throw new DatabaseResetError(
      `Refusing to reset PostgreSQL maintenance database "${name}".`,
    );
  }
}

export async function resetDatabase(
  connectionString: string,
  environment: string | undefined,
): Promise<MigrationResult> {
  assertDatabaseResetAllowed(connectionString, environment);
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT USAGE ON SCHEMA public TO PUBLIC");
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  return runMigrations(connectionString);
}

async function confirmReset(name: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new DatabaseResetError(
      "Non-interactive reset requires the --yes flag.",
    );
  }

  const reader = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await reader.question(
      `Type "${name}" to delete all application data: `,
    );
    return answer === name;
  } finally {
    reader.close();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new DatabaseResetError("DATABASE_URL is not set.");
  }

  assertDatabaseResetAllowed(connectionString, process.env.NODE_ENV);
  const name = databaseName(connectionString);
  const assumeYes = process.argv.slice(2).includes("--yes");
  if (!assumeYes && !(await confirmReset(name))) {
    console.warn("Database reset cancelled.");
    return;
  }

  console.warn(`Resetting local database "${name}"...`);
  const result = await resetDatabase(connectionString, process.env.NODE_ENV);
  console.warn(
    `Database ready. ${result.applied.length} migrations applied. Run bun run admin:create next.`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
