import { runMigrations } from "./migrate.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exitCode = 1;
} else {
  const result = await runMigrations(connectionString);
  for (const name of result.applied) console.warn(`applied  ${name}`);
  for (const name of result.skipped) console.warn(`skipped  ${name}`);
  console.warn(
    `${result.applied.length} applied, ${result.skipped.length} already present.`,
  );
}
