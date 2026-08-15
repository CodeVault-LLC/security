import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { seedBuiltIns } from "./startup/seed.js";

/**
 * Server entry point.
 *
 * Configuration is validated, built-in policy packs and report templates are
 * seeded, the job queue is started, and the process installs handlers so a
 * container stop drains cleanly instead of dropping in-flight requests.
 */

async function main(): Promise<void> {
  let config;

  try {
    config = loadConfig();
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exitCode = 1;

      return;
    }

    throw error;
  }

  const app = await buildApp({ config });

  await seedBuiltIns(app.db);
  await app.jobs.start();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");

    await app.close();
    await app.jobs.stop();
    await app.dbHandle.close();

    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: config.server.host, port: config.server.port });
}

await main();
