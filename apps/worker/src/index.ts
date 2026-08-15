import { ConfigError, loadConfig } from "@codevault/server/config";

import { createWorkerContext } from "./context.js";
import { startQueue } from "./queue.js";

/**
 * Worker entry point.
 *
 * Runs alongside the API and shares its database. Everything slow, untrusted or
 * outward-facing happens here: decoding uploaded files, driving Chromium for a
 * PDF, and talking to advisory databases.
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

  const context = createWorkerContext(config);
  const queue = await startQueue(context, {
    connectionString: config.database.connectionString,
  });

  const shutdown = async (signal: string): Promise<void> => {
    context.log(`shutting down on ${signal}`);

    await queue.stop();
    await context.dbHandle.close();

    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

await main();
