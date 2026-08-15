import type { Database, DatabaseHandle } from "@codevault/db";
import { createDatabase } from "@codevault/db";
import type { ServerConfig } from "@codevault/server/config";
import {
  createObjectStorage,
  type ObjectStorage,
} from "@codevault/server/services/storage";

/**
 * Worker context.
 *
 * The worker shares the server's configuration and storage client but is a
 * separate process on purpose: it decodes untrusted files, drives a browser and
 * talks to third-party services, none of which belongs inside the process that
 * answers authenticated API requests.
 */

export interface WorkerContext {
  config: ServerConfig;
  dbHandle: DatabaseHandle;
  db: Database;
  storage: ObjectStorage;
  log(message: string): void;
}

export function createWorkerContext(config: ServerConfig): WorkerContext {
  const dbHandle = createDatabase({
    connectionString: config.database.connectionString,
    maxConnections: config.database.maxConnections,
    ssl: config.database.ssl,
  });

  return {
    config,
    dbHandle,
    db: dbHandle.db,
    storage: createObjectStorage(config),
    log(message: string) {
      console.warn(`[worker] ${message}`);
    },
  };
}
